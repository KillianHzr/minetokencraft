import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS_DIR, CACHE_DIR, HOST, POLL_MS, PORT } from './config.mjs';
import { collectState, knownPlayer } from './lib/sessions.mjs';
import { sessionHistory } from './lib/transcript.mjs';
import { focusSession } from './lib/focus.mjs';
import { notificationsSupported, notifyChanges } from './lib/notify.mjs';
import { publicSettings, updateSettings } from './lib/settings.mjs';
import { refreshWeather, startWeather } from './lib/weather.mjs';
import { accountsOverview, allAccounts } from './lib/accounts.mjs';
import { refreshLimits, startLimits } from './lib/limits.mjs';
import { fillMissingAssets } from './scripts/fetch-assets.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_MS = 15000;
// Where Node finds three.js: next to the server in a clone or a global install, higher up when npm hoists it (npx, a
// local install).
const THREE_DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('three')), '..');

// URL prefix -> served folder.
const STATIC_ROUTES = [
  ['/assets/', ASSETS_DIR],
  ['/vendor/three/', THREE_DIR],
  ['/', path.join(root, 'public')],
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

// Headers of every answer: no sniffing, no referrer, not readable or embeddable by another site.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/**
 * Content Security Policy of the page: only its own scripts (the inline import map by its hash), its own styles plus
 * style attributes, its own images and those it draws, its own fonts, and requests to this server only. No frames,
 * no forms, no plugins, nothing loaded from elsewhere.
 */
function contentSecurityPolicy(html) {
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, code]) => `'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`);
  return [
    "default-src 'none'",
    `script-src 'self' ${inline.join(' ')}`,
    "style-src 'self'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const clients = new Set();
let lastPayload = null;
let lastState = null;

async function serveStatic(pathname, res) {
  const [prefix, dir] = STATIC_ROUTES.find(([routePrefix]) => pathname.startsWith(routePrefix));
  // The test page (/demo) is the same page, fed with fake sessions.
  const relative = pathname === '/' || pathname === '/demo' ? 'index.html' : decodeURIComponent(pathname.slice(prefix.length));
  const file = path.resolve(dir, relative);
  if (!file.startsWith(dir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    const page = path.extname(file) === '.html';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...(page ? { 'Content-Security-Policy': contentSecurityPolicy(body.toString('utf8')) } : {}),
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

function openEventStream(res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  if (lastPayload) res.write(`data: ${lastPayload}\n\n`);
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

async function poll() {
  try {
    const state = await collectState();
    const payload = JSON.stringify(state);
    // `now` changes on every tick: only the rest is compared.
    if (payload.slice(payload.indexOf(',')) !== lastPayload?.slice(lastPayload.indexOf(','))) {
      lastPayload = payload;
      for (const client of clients) client.write(`data: ${payload}\n\n`);
    }
    await notifyChanges(lastState, state);
    lastState = state;
  } catch (error) {
    console.error('cannot read sessions:', error);
  }
  setTimeout(poll, POLL_MS);
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// Requests that act require JSON: another site open in the browser cannot send any
// without a preflight request, which this server refuses.
function isJsonPost(req) {
  return req.method === 'POST' && req.headers['content-type']?.startsWith('application/json');
}

async function handleApi(req, res, pathname) {
  const [, , resource, id, agentId] = pathname.split('/').map(decodeURIComponent);
  if (resource === 'state') return res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' }).end(lastPayload ?? '{}');
  if (resource === 'history') {
    // A session's history, or one of its sub-agents' (/api/history/<player>/<villager>).
    const player = knownPlayer(id);
    const file = agentId ? player?.agents?.get(agentId) : player?.file;
    if (!file) return sendJson(res, 404, { error: 'unknown session' });
    // Another assistant reads its own log format.
    return sendJson(res, 200, { events: !agentId && player.history ? await player.history() : await sessionHistory(file) });
  }
  if (resource === 'focus' && isJsonPost(req)) {
    const player = knownPlayer(id);
    const data = lastState?.players.find((candidate) => candidate.id === id);
    if (!player || !data) return sendJson(res, 404, { ok: false, code: 'unknown' });
    // Codex and Gemini CLI do not say which process runs a session.
    if (!player.pid) return sendJson(res, 200, { ok: false, code: 'noTerminal' });
    return sendJson(res, 200, await focusSession({ ...player, name: data.name }));
  }
  if (resource === 'accounts') return sendJson(res, 200, await accountsOverview());
  if (resource === 'settings') {
    if (!isJsonPost(req)) return sendJson(res, 200, { ...await publicSettings(), notificationsSupported: await notificationsSupported() });
    try {
      const patch = await readBody(req);
      const settings = await updateSettings(patch);
      // New account, label, folder or city: visible from the next read, without waiting.
      await allAccounts({ fresh: true });
      if (typeof patch.city === 'string') refreshWeather();
      // Session key or Keychain access: quotas are re-read right away (macOS may then ask for
      // permission to open the Keychain; the response comes back without making the page wait).
      for (const [id, change] of Object.entries(patch.accounts ?? {})) {
        if ('sessionKey' in change || 'keychain' in change) refreshLimits(id).catch(() => {});
      }
      return sendJson(res, 200, settings);
    } catch (error) {
      return sendJson(res, 400, { ok: false, code: error.code ?? 'refused', message: error.message });
    }
  }
  return sendJson(res, 404, { error: 'not found' });
}

// Only local machine names are accepted: a malicious web page cannot reach the server by
// pointing one of its domains at 127.0.0.1 (DNS rebinding).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalHost(req) {
  const host = req.headers.host ?? '';
  return LOCAL_HOSTS.has(host.replace(/:\d+$/, ''));
}

const server = http.createServer((req, res) => {
  if (!isLocalHost(req)) return res.writeHead(421).end();
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/events') return openEventStream(res);
  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname).catch((error) => sendJson(res, 500, { ok: false, message: error.message }));
  }
  return serveStatic(pathname, res);
});

setInterval(() => {
  for (const client of clients) client.write(': ping\n\n');
}, HEARTBEAT_MS);

startWeather();
startLimits();
fillMissingAssets().catch((error) => console.error('cannot download assets:', error.message));
// PID file: `minetokencraft stop` uses it to stop a server started in the background.
const PID_FILE = path.join(CACHE_DIR, 'server.pid');

// Listen first: the first pass reads whole transcripts, which takes a few seconds with big sessions. The page waits
// for it on the live stream.
server.listen(PORT, HOST, async () => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid));
  console.log(`MineTokenCraft: http://localhost:${PORT}`);
  poll();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await fs.rm(PID_FILE, { force: true });
    process.exit(0);
  });
}
