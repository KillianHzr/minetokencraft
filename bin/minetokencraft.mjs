#!/usr/bin/env node
// minetokencraft: starts the server unless it already runs, then opens the page in the browser.
//
//   minetokencraft                    starts (in the background) and opens the page
//   minetokencraft demo               opens the test page, with fake sessions
//   minetokencraft stop               stops the server started by minetokencraft
//   minetokencraft autostart on|off|status   starts at login (macOS)
//   minetokencraft assets [--refresh-skins] [--skins a,b]   downloads textures, font and skins (again)
//   minetokencraft statusline [--quiet]      status line for Claude Code (see the README)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR, PORT } from '../config.mjs';
import { translator } from '../lib/i18n.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = `http://localhost:${PORT}`;
const PID_FILE = path.join(CACHE_DIR, 'server.pid');
const LOG_FILE = path.join(CACHE_DIR, 'server.log');
const START_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t = await translator();

async function isRunning() {
  try {
    const response = await fetch(`${URL_BASE}/api/settings`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
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
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (const started = Date.now(); Date.now() - started < START_TIMEOUT_MS; await sleep(250)) {
    if (await isRunning()) return true;
  }
  console.error(t('cli.noAnswer', { log: LOG_FILE }));
  return false;
}

async function open(page = '') {
  if (!(await isRunning())) {
    await ensureAssets();
    console.log(t('cli.starting'));
    if (!(await startServer())) process.exit(1);
  }
  console.log(`MineTokenCraft: ${URL_BASE}/${page}`);
  openBrowser(`${URL_BASE}/${page}`);
}

function stop() {
  let pid;
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    process.kill(pid, 'SIGTERM');
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
