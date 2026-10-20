import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Brings to the front the terminal a session runs in: we walk up its parent processes to the
// application (PhpStorm, Terminal, iTerm…).

const run = promisify(execFile);
const home = os.homedir();
const MAX_ANCESTORS = 10;
const JETBRAINS_DIR = path.join(home, 'Library', 'Application Support', 'JetBrains');
const OPEN_PROJECT = /<entry key="([^"]+)">\s*<value>\s*<RecentProjectMetaInfo([^>]*)>/g;

async function parentOf(pid) {
  const { stdout } = await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)]);
  const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
  return match ? { pid: Number(match[1]), command: match[2] } : null;
}

/**
 * Application hosting the process: the first one whose path goes through a `.app`.
 */
async function hostApp(pid) {
  let current = pid;
  for (let i = 0; i < MAX_ANCESTORS && current > 1; i++) {
    const parent = await parentOf(current).catch(() => null);
    if (!parent) return null;
    const appEnd = parent.command.indexOf('.app/');
    if (appEnd !== -1) return parent.command.slice(0, appEnd + 4);
    current = parent.pid;
  }
  return null;
}

/**
 * Project open in the JetBrains IDE that contains the session folder (the most specific one).
 */
async function openJetBrainsProject(appPath, cwd) {
  const product = path.basename(appPath, '.app').replace(/\s+/g, '');
  let dirs;
  try {
    dirs = (await fs.readdir(JETBRAINS_DIR)).filter((dir) => dir.toLowerCase().startsWith(product.toLowerCase()) && /\d/.test(dir));
  } catch {
    return null;
  }
  const candidates = await Promise.all(dirs.map(async (dir) => {
    const file = path.join(JETBRAINS_DIR, dir, 'options', 'recentProjects.xml');
    const stat = await fs.stat(file).catch(() => null);
    return stat && { file, mtime: stat.mtimeMs };
  }));
  const latest = candidates.filter(Boolean).sort((a, b) => b.mtime - a.mtime)[0];
  if (!latest) return null;
  const xml = await fs.readFile(latest.file, 'utf8');
  const open = [...xml.matchAll(OPEN_PROJECT)]
    .filter(([, , attributes]) => attributes.includes('opened="true"'))
    .map(([, key]) => key.replace('$USER_HOME$', home));
  return open.filter((project) => cwd === project || cwd.startsWith(`${project}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

async function ttyOf(pid) {
  const { stdout } = await run('ps', ['-o', 'tty=', '-p', String(pid)]);
  const tty = stdout.trim();
  return tty && tty !== '??' ? `/dev/${tty}` : null;
}

// Selecting the tab by its terminal: Terminal and iTerm allow it, PhpStorm does not.
const SELECT_TAB = {
  Terminal: [
    'on run argv',
    'tell application "Terminal"',
    'activate',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'if tty of t is (item 1 of argv) then',
    'set selected of t to true',
    'set index of w to 1',
    'end if',
    'end repeat',
    'end repeat',
    'end tell',
    'end run',
  ],
  iTerm: [
    'on run argv',
    'tell application "iTerm2"',
    'activate',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'repeat with s in sessions of t',
    'if tty of s is (item 1 of argv) then',
    'select w',
    'select t',
    'select s',
    'end if',
    'end repeat',
    'end repeat',
    'end repeat',
    'end tell',
    'end run',
  ],
};

/**
 * Brings the session terminal to the front, and says what was done.
 */
export async function focusSession(player) {
  if (process.platform !== 'darwin') return { ok: false, code: 'notMac' };
  const appPath = await hostApp(player.pid);
  if (!appPath) return { ok: false, code: 'background' };
  const appName = path.basename(appPath, '.app');
  if (SELECT_TAB[appName.replace('2', '')]) {
    const tty = await ttyOf(player.pid);
    if (tty) {
      await run('osascript', [...SELECT_TAB[appName.replace('2', '')].flatMap((line) => ['-e', line]), tty]);
      return { ok: true, code: 'tab', app: appName };
    }
  }
  const project = await openJetBrainsProject(appPath, player.cwd).catch(() => null);
  if (project) {
    await run('open', ['-a', appPath, project]);
    return { ok: true, code: 'window', app: appName, project: path.basename(project) };
  }
  await run('open', ['-a', appPath]);
  return { ok: true, code: 'app', app: appName };
}
