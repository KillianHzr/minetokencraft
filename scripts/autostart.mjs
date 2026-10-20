// Starts the server at macOS login (launchd agent), or removes that start.
// Usage: minetokencraft autostart on | off | status (or node scripts/autostart.mjs …)
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { translator } from '../lib/i18n.mjs';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.minetokencraft';
const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logFile = path.join(os.homedir(), 'Library', 'Logs', 'minetokencraft.log');
const domain = `gui/${process.getuid()}`;
// After a crash, launchd waits this long before starting again: no loop when the port is taken.
const THROTTLE_S = 10;

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist() {
  // Absolute path of the node running this script: launchd knows neither nvm nor the terminal PATH.
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
  console.log((await translator())('cli.autostartOff'));
}

async function on() {
  if (await loaded()) await run('launchctl', ['bootout', `${domain}/${LABEL}`]);
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  await fs.writeFile(plistFile, plist());
  await run('launchctl', ['bootstrap', domain, plistFile]);
  console.log((await translator())('cli.autostartOn', { plist: plistFile, log: logFile }));
}

async function status() {
  const t = await translator();
  console.log(await loaded() ? t('cli.autostartActive', { plist: plistFile }) : t('cli.autostartInactive'));
}

const ACTIONS = { on, off, status };

/**
 * Start at login: `on`, `off` or `status`. macOS only (launchd).
 */
export async function autostart(action) {
  const t = await translator();
  if (process.platform !== 'darwin') {
    console.log(t('cli.autostartMacOnly'));
    return false;
  }
  if (!ACTIONS[action]) {
    console.log(t('cli.autostartUsage'));
    return false;
  }
  await ACTIONS[action]();
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = (await autostart(process.argv[2])) ? 0 : 1;
}
