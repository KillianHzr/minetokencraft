#!/usr/bin/env node
// minetokencraft: starts the server unless it already runs, then opens the page in the browser.
//
//   minetokencraft                    starts (in the background) and opens the page
//   minetokencraft demo               opens the test page, with fake sessions
//   minetokencraft stop               stops the server started by minetokencraft
//   minetokencraft autostart on|off|status   starts at login (macOS, Linux)
//   minetokencraft assets [--refresh-skins] [--skins a,b]   downloads textures, font and skins (again)
//   minetokencraft statusline [--quiet]      status line for Claude Code (see the README)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR, PORT } from '../config.mjs';
import { translator } from '../lib/i18n.mjs';
import { olderThan, VERSION } from '../lib/version.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = `http://localhost:${PORT}`;
const PID_FILE = path.join(CACHE_DIR, 'server.pid');
const LOG_FILE = path.join(CACHE_DIR, 'server.log');
const START_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t = await translator();

/**
 * Version of the server that answers on the port: '' for one too old to tell it, null if none answers.
 */
async function runningVersion() {
  try {
    const response = await fetch(`${URL_BASE}/api/settings`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok ? (await response.json()).version ?? '' : null;
  } catch {
    return null;
  }
}

const isRunning = async () => (await runningVersion()) !== null;

async function waitFor(check) {
  for (const started = Date.now(); Date.now() - started < START_TIMEOUT_MS; await sleep(250)) {
    if (await check()) return true;
  }
  return false;
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

async function ensureAssets() {
  const { assetsReady, fetchAssets } = await import('../scripts/fetch-assets.mjs');
  if (await assetsReady()) return;
  console.log(t('cli.firstRun'));
  await fetchAssets();
}

/**
 * Starts the server detached from the terminal (it keeps running once the terminal closes), logging to the cache.
 */
async function startServer() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.unref();
  if (await waitFor(isRunning)) return true;
  console.error(t('cli.noAnswer', { log: LOG_FILE }));
  return false;
}

function serverPid() {
  try {
    return Number(fs.readFileSync(PID_FILE, 'utf8')) || null;
  } catch {
    return null;
  }
}

/**
 * A server left running by an older version (`npm install -g minetokencraft@latest` does not stop it) is restarted on
 * this one: through the start at login when that is what runs it, which then points at this install.
 */
async function restartServer() {
  const pid = serverPid();
  // Not started by minetokencraft (`serve` in another folder, say): left alone.
  if (!pid) {
    console.log(t('cli.cannotRestart'));
    return true;
  }
  console.log(t('cli.updating', { version: VERSION }));
  const { autostartRunning } = await import('../scripts/autostart.mjs');
  const service = await autostartRunning(pid);
  if (service) {
    await service.on();
    if (await waitFor(async () => (await runningVersion()) === VERSION)) return true;
    console.error(t('cli.noAnswer', { log: service.log }));
    return false;
  }
  process.kill(pid, 'SIGTERM');
  await waitFor(async () => !(await isRunning()));
  return startServer();
}

async function open(page = '') {
  const running = await runningVersion();
  if (running === null) {
    await ensureAssets();
    console.log(t('cli.starting'));
    if (!(await startServer())) process.exit(1);
  } else if (olderThan(running, VERSION) && !(await restartServer())) {
    process.exit(1);
  }
  console.log(`MineTokenCraft: ${URL_BASE}/${page}`);
  openBrowser(`${URL_BASE}/${page}`);
}

function stop() {
  try {
    process.kill(serverPid(), 'SIGTERM');
    console.log(t('cli.stopped'));
  } catch {
    console.log(t('cli.notRunning'));
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case undefined:
  case 'open':
    await open();
    break;
  case 'demo':
    await open('demo');
    break;
  case 'stop':
    stop();
    break;
  case 'autostart': {
    const { autostart } = await import('../scripts/autostart.mjs');
    process.exitCode = (await autostart(args[0])) ? 0 : 1;
    break;
  }
  case 'assets': {
    const { assetOptions, fetchAssets } = await import('../scripts/fetch-assets.mjs');
    await fetchAssets(assetOptions(args));
    break;
  }
  case 'statusline': {
    const { statusline } = await import('../scripts/statusline.mjs');
    await statusline(args);
    break;
  }
  case 'serve':
    // In the foreground, in this terminal (log shown, Ctrl+C to stop).
    await ensureAssets();
    await import('../server.mjs');
    break;
  default:
    console.log(t('cli.usage'));
    process.exitCode = 1;
}
