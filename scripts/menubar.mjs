// The menu bar app on macOS: built here from macos/MenuBar.swift with the Swift compiler of the Xcode command line
// tools, put in ~/Applications, and started at login by launchd. Built on the machine, it needs no signature.
// Usage: minetokencraft menubar on | off | status
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PORT } from '../config.mjs';
import { translator } from '../lib/i18n.mjs';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.minetokencraft.menubar';
const APP = path.join(os.homedir(), 'Applications', 'MineTokenCraft Bar.app');
const BINARY = path.join(APP, 'Contents', 'MacOS', 'MineTokenCraftBar');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const INFO = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundleName</key><string>MineTokenCraft Bar</string>
  <key>CFBundleExecutable</key><string>MineTokenCraftBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;

// Started at login; started again after a crash, but not after "Quit" in its menu.
const agent = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${escapeXml(BINARY)}</string><string>--port</string><string>${PORT}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
`;

const domain = () => `gui/${process.getuid()}`;
const loaded = () => run('launchctl', ['print', `${domain()}/${LABEL}`]).then(() => true, () => false);

async function build() {
  await fs.mkdir(path.dirname(BINARY), { recursive: true });
  await fs.writeFile(path.join(APP, 'Contents', 'Info.plist'), INFO);
  await run('swiftc', ['-O', '-o', BINARY, path.join(root, 'macos', 'MenuBar.swift')]);
  // Ad hoc signature: enough for an app built on the machine.
  await run('codesign', ['--force', '--sign', '-', APP]);
}

async function on(t) {
  const swift = await run('swiftc', ['--version']).then(() => true, () => false);
  if (!swift) {
    console.log(t('cli.menubarNoSwift'));
    return false;
  }
  if (await loaded()) await run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
  console.log(t('cli.menubarBuilding'));
  await build();
  await fs.mkdir(path.dirname(PLIST), { recursive: true });
  await fs.writeFile(PLIST, agent());
  await run('launchctl', ['bootstrap', domain(), PLIST]);
  console.log(t('cli.menubarOn', { app: APP }));
  return true;
}

async function off(t) {
  if (await loaded()) await run('launchctl', ['bootout', `${domain()}/${LABEL}`]);
  await fs.rm(PLIST, { force: true });
  await fs.rm(APP, { recursive: true, force: true });
  console.log(t('cli.menubarOff'));
  return true;
}

/**
 * `on` builds, installs and starts the app (and at every login), `off` removes it, `status` says if it runs.
 */
export async function menubar(action) {
  const t = await translator();
  if (process.platform !== 'darwin') {
    console.log(t('cli.menubarMacOnly'));
    return false;
  }
  if (action === 'on') return on(t);
  if (action === 'off') return off(t);
  if (action === 'status') {
    console.log(await loaded() ? t('cli.autostartActive', { file: APP }) : t('cli.autostartInactive'));
    return true;
  }
  console.log(t('cli.menubarUsage'));
  return false;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = (await menubar(process.argv[2])) ? 0 : 1;
}
