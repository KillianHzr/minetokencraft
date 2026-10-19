#!/usr/bin/env node
// minetokencraft : lance le serveur s'il ne tourne pas déjà, puis ouvre la page dans le navigateur.
//
//   minetokencraft                    démarre (en arrière-plan) et ouvre la page
//   minetokencraft demo               ouvre la page de test, avec des sessions factices
//   minetokencraft stop               arrête le serveur lancé par minetokencraft
//   minetokencraft autostart on|off|status   lancement à l'ouverture de session (macOS)
//   minetokencraft assets [--refresh-skins] [--skins a,b]   (re)télécharge textures, police et skins
//   minetokencraft statusline [--quiet]      status line pour Claude Code (voir le README)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_DIR, PORT } from '../config.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = `http://localhost:${PORT}`;
const PID_FILE = path.join(CACHE_DIR, 'server.pid');
const LOG_FILE = path.join(CACHE_DIR, 'server.log');
const START_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  console.log('Premier lancement : téléchargement des textures, de la police et des skins…');
  await fetchAssets();
}

/**
 * Démarre le serveur détaché du terminal (il continue après sa fermeture), journal dans le cache.
 */
async function startServer() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (const started = Date.now(); Date.now() - started < START_TIMEOUT_MS; await sleep(250)) {
    if (await isRunning()) return true;
  }
  console.error(`Le serveur ne répond pas. Journal : ${LOG_FILE}`);
  return false;
}

async function open(page = '') {
  if (!(await isRunning())) {
    await ensureAssets();
    console.log('Démarrage du serveur…');
    if (!(await startServer())) process.exit(1);
  }
  console.log(`MineTokenCraft : ${URL_BASE}/${page}`);
  openBrowser(`${URL_BASE}/${page}`);
}

function stop() {
  let pid;
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    process.kill(pid, 'SIGTERM');
    console.log('Serveur arrêté.');
  } catch {
    console.log('Aucun serveur lancé par minetokencraft ne tourne.');
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
    // Au premier plan, dans ce terminal (journal affiché, Ctrl+C pour arrêter).
    await ensureAssets();
    await import('../server.mjs');
    break;
  default:
    console.log('Usage : minetokencraft [demo | stop | serve | autostart on|off|status | assets | statusline]');
    process.exitCode = 1;
}
