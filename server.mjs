import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS_DIR, CACHE_DIR, HOST, POLL_MS, PORT } from './config.mjs';
import { collectState, knownPlayer } from './lib/sessions.mjs';
import { sessionHistory } from './lib/transcript.mjs';
import { focusSession } from './lib/focus.mjs';
import { notifyChanges } from './lib/notify.mjs';
import { publicSettings, updateSettings } from './lib/settings.mjs';
import { refreshWeather, startWeather } from './lib/weather.mjs';
import { accountsOverview, allAccounts } from './lib/accounts.mjs';
import { refreshLimits, startLimits } from './lib/limits.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_MS = 15000;

// Préfixe d'URL -> dossier servi.
const STATIC_ROUTES = [
  ['/assets/', ASSETS_DIR],
  ['/vendor/three/', path.join(root, 'node_modules', 'three')],
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
};

const clients = new Set();
let lastPayload = null;
let lastState = null;

async function serveStatic(pathname, res) {
  const [prefix, dir] = STATIC_ROUTES.find(([routePrefix]) => pathname.startsWith(routePrefix));
  // La page de test (/demo) est la même page, nourrie par des sessions factices.
  const relative = pathname === '/' || pathname === '/demo' ? 'index.html' : decodeURIComponent(pathname.slice(prefix.length));
  const file = path.resolve(dir, relative);
  if (!file.startsWith(dir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

function openEventStream(res) {
  res.writeHead(200, {
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
    // `now` change à chaque tour : on ne compare que le reste.
    if (payload.slice(payload.indexOf(',')) !== lastPayload?.slice(lastPayload.indexOf(','))) {
      lastPayload = payload;
      for (const client of clients) client.write(`data: ${payload}\n\n`);
    }
    await notifyChanges(lastState, state);
    lastState = state;
  } catch (error) {
    console.error('lecture des sessions impossible :', error);
  }
  setTimeout(poll, POLL_MS);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// Les requêtes qui agissent exigent du JSON : un autre site ouvert dans le navigateur ne peut pas en envoyer
// sans demande préalable, que ce serveur refuse.
function isJsonPost(req) {
  return req.method === 'POST' && req.headers['content-type']?.startsWith('application/json');
}

async function handleApi(req, res, pathname) {
  const [, , resource, id] = pathname.split('/').map(decodeURIComponent);
  if (resource === 'state') return res.writeHead(200, { 'Content-Type': MIME_TYPES['.json'] }).end(lastPayload ?? '{}');
  if (resource === 'history') {
    const player = knownPlayer(id);
    if (!player?.file) return sendJson(res, 404, { error: 'session inconnue' });
    return sendJson(res, 200, { events: await sessionHistory(player.file) });
  }
  if (resource === 'focus' && isJsonPost(req)) {
    const player = knownPlayer(id);
    const data = lastState?.players.find((candidate) => candidate.id === id);
    if (!player || !data) return sendJson(res, 404, { ok: false, message: 'Session inconnue.' });
    return sendJson(res, 200, await focusSession({ ...player, name: data.name }));
  }
  if (resource === 'accounts') return sendJson(res, 200, await accountsOverview());
  if (resource === 'settings') {
    if (!isJsonPost(req)) return sendJson(res, 200, await publicSettings());
    try {
      const patch = await readBody(req);
      const settings = await updateSettings(patch);
      // Nouveau compte, libellé, dossier ou ville : visible dès la prochaine lecture, sans attendre.
      await allAccounts({ fresh: true });
      if (typeof patch.city === 'string') refreshWeather();
      // Clé de session ou accès au trousseau : les quotas sont relus tout de suite (macOS peut alors demander la
      // permission d'ouvrir le trousseau ; la réponse arrive sans faire attendre la page).
      for (const [id, change] of Object.entries(patch.accounts ?? {})) {
        if ('sessionKey' in change || 'keychain' in change) refreshLimits(id).catch(() => {});
      }
      return sendJson(res, 200, settings);
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }
  return sendJson(res, 404, { error: 'introuvable' });
}

// Seuls les noms de la machine locale sont acceptés : une page web malveillante ne peut pas atteindre le serveur en
// faisant pointer un de ses domaines vers 127.0.0.1 (rebinding DNS).
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
await poll();
// Fichier de PID : `minetokencraft stop` s'en sert pour arrêter un serveur lancé en arrière-plan.
const PID_FILE = path.join(CACHE_DIR, 'server.pid');

server.listen(PORT, HOST, async () => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(PID_FILE, String(process.pid));
  console.log(`MineTokenCraft : http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await fs.rm(PID_FILE, { force: true });
    process.exit(0);
  });
}
