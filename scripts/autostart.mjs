// Lance le serveur à l'ouverture de session macOS (agent launchd), ou retire ce lancement.
// Usage : minetokencraft autostart on | off | status (ou node scripts/autostart.mjs …)
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.minetokencraft';
const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logFile = path.join(os.homedir(), 'Library', 'Logs', 'minetokencraft.log');
const domain = `gui/${process.getuid()}`;
// Après un plantage, launchd attend ce délai avant de relancer : pas de boucle si le port est pris.
const THROTTLE_S = 10;

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist() {
  // Chemin absolu du node qui lance ce script : launchd ne connaît ni nvm ni le PATH du terminal.
  const strings = (values) => values.map((value) => `<string>${escapeXml(value)}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${strings([process.execPath, path.join(root, 'server.mjs')])}</array>
  <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${THROTTLE_S}</integer>
  <key>StandardOutPath</key><string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

async function loaded() {
  try {
    await run('launchctl', ['print', `${domain}/${LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

async function off() {
  if (await loaded()) await run('launchctl', ['bootout', `${domain}/${LABEL}`]);
  await fs.rm(plistFile, { force: true });
  console.log('Démarrage automatique retiré.');
}

async function on() {
  if (await loaded()) await run('launchctl', ['bootout', `${domain}/${LABEL}`]);
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  await fs.writeFile(plistFile, plist());
  await run('launchctl', ['bootstrap', domain, plistFile]);
  console.log(`Démarrage automatique installé : ${plistFile}\nJournal : ${logFile}`);
}

async function status() {
  console.log(await loaded() ? `Actif (${plistFile})` : 'Inactif');
}

const ACTIONS = { on, off, status };

/**
 * Démarrage automatique à l'ouverture de session : `on`, `off` ou `status`. macOS seulement (launchd).
 */
export async function autostart(action) {
  if (process.platform !== 'darwin') {
    console.log('Le démarrage automatique passe par launchd : il n\'existe que sur macOS.');
    return false;
  }
  if (!ACTIONS[action]) {
    console.log('Usage : minetokencraft autostart on | off | status');
    return false;
  }
  await ACTIONS[action]();
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = (await autostart(process.argv[2])) ? 0 : 1;
}
