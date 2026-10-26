// Starts the server at login, or removes that start: a launchd agent on macOS, a systemd user service on Linux.
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
const server = path.join(root, 'server.mjs');
// After a crash, wait this long before starting again: no loop when the port is taken.
const RESTART_DELAY_S = 10;

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * macOS: a launchd agent in ~/Library/LaunchAgents, logging to ~/Library/Logs.
 */
function launchd() {
  const label = 'local.minetokencraft';
  const file = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const log = path.join(os.homedir(), 'Library', 'Logs', 'minetokencraft.log');
  const domain = `gui/${process.getuid()}`;
  const loaded = () => run('launchctl', ['print', `${domain}/${label}`]).then(() => true, () => false);
  // Absolute path of the node running this script: launchd knows neither nvm nor the terminal PATH.
  const strings = (values) => values.map((value) => `<string>${escapeXml(value)}</string>`).join('');
  const definition = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${strings([process.execPath, server])}</array>
  <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${RESTART_DELAY_S}</integer>
  <key>StandardOutPath</key><string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(log)}</string>
</dict>
</plist>
`;
  return {
    file,
    log,
    loaded,
    pid: () => run('launchctl', ['print', `${domain}/${label}`]).then(({ stdout }) => Number(stdout.match(/^\s*pid = (\d+)/m)?.[1]) || null, () => null),
    async on() {
      if (await loaded()) await run('launchctl', ['bootout', `${domain}/${label}`]);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, definition);
      await run('launchctl', ['bootstrap', domain, file]);
    },
    async off() {
      if (await loaded()) await run('launchctl', ['bootout', `${domain}/${label}`]);
      await fs.rm(file, { force: true });
    },
  };
}

/**
 * Linux: a systemd user service, logging to the journal (`journalctl --user -u minetokencraft`).
 */
function systemd() {
  const unit = 'minetokencraft.service';
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const file = path.join(configHome, 'systemd', 'user', unit);
  const quote = (value) => `"${value.replace(/(["\\])/g, '\\$1')}"`;
  const definition = `[Unit]
Description=MineTokenCraft, Claude Code sessions in a Minecraft village

[Service]
ExecStart=${quote(process.execPath)} ${quote(server)}
WorkingDirectory=${root}
Restart=on-failure
RestartSec=${RESTART_DELAY_S}

[Install]
WantedBy=default.target
`;
  return {
    file,
    log: `journalctl --user -u ${unit}`,
    loaded: () => run('systemctl', ['--user', 'is-enabled', unit]).then(() => true, () => false),
    pid: () => run('systemctl', ['--user', 'show', '--property', 'MainPID', '--value', unit]).then(({ stdout }) => Number(stdout.trim()) || null, () => null),
    async on() {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, definition);
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', unit]);
      // Restart rather than start: a server already running moves to this definition, and to this install.
      await run('systemctl', ['--user', 'restart', unit]);
    },
    async off() {
      await run('systemctl', ['--user', 'disable', '--now', unit]).catch(() => {});
      await fs.rm(file, { force: true });
      await run('systemctl', ['--user', 'daemon-reload']).catch(() => {});
    },
  };
}

const SERVICES = { darwin: launchd, linux: systemd };

/**
 * The start at login, if it is what runs the server `pid`: an update restarts the server through it, so that it keeps
 * starting the server, from the new install.
 */
export async function autostartRunning(pid) {
  const service = SERVICES[process.platform]?.();
  return service && pid && (await service.pid()) === pid ? service : null;
}

/**
 * Start at login: `on`, `off` or `status`, on macOS and Linux.
 */
export async function autostart(action) {
  const t = await translator();
  if (!SERVICES[process.platform]) {
    console.log(t('cli.autostartUnsupported'));
    return false;
  }
  if (!['on', 'off', 'status'].includes(action)) {
    console.log(t('cli.autostartUsage'));
    return false;
  }
  const service = SERVICES[process.platform]();
  if (action === 'on') {
    await service.on();
    console.log(t('cli.autostartOn', { file: service.file, log: service.log }));
  } else if (action === 'off') {
    await service.off();
    console.log(t('cli.autostartOff'));
  } else {
    console.log(await service.loaded() ? t('cli.autostartActive', { file: service.file }) : t('cli.autostartInactive'));
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = (await autostart(process.argv[2])) ? 0 : 1;
}
