// Package test, run by continuous integration before every release: packs the npm package, installs it the two ways
// users do (`npm install -g`, and hoisted like `npx` or a local install), runs the command, starts the installed
// server on a fake home folder, and fetches the page, the test page and every module they import. With --browser, it
// also opens both pages in headless Chrome, in the village, in simple mode and on the usage screen, and fails on any
// error of the page. For maintainers: nothing here touches the real home folder.
// Usage: npm run smoke [-- --browser]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.argv.includes('--browser');
const START_TIMEOUT_MS = 20000;
const FAKE_SKINS = 4;
const windows = process.platform === 'win32';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minetokencraft-smoke-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a command and returns its output. npm and the installed command are .cmd scripts on Windows, which only run
 * through a shell.
 */
function run(command, args, options = {}) {
  const quote = (arg) => (windows && /\s/.test(arg) ? `"${arg}"` : arg);
  return execFileSync(quote(command), args.map(quote), { encoding: 'utf8', shell: windows, stdio: ['ignore', 'pipe', 'inherit'], ...options });
}

const npm = (args, cwd) => run(windows ? 'npm.cmd' : 'npm', [...args, '--no-audit', '--no-fund'], { cwd });

function installGlobal(tarball) {
  const prefix = path.join(work, 'global');
  npm(['install', '--global', '--prefix', prefix, tarball], work);
  return {
    name: 'npm install -g',
    dir: windows ? path.join(prefix, 'node_modules', 'minetokencraft') : path.join(prefix, 'lib', 'node_modules', 'minetokencraft'),
    bin: windows ? path.join(prefix, 'minetokencraft.cmd') : path.join(prefix, 'bin', 'minetokencraft'),
  };
}

function installHoisted(tarball) {
  const project = path.join(work, 'local');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{ "private": true }\n');
  npm(['install', tarball], project);
  return {
    name: 'local install, hoisted like npx',
    dir: path.join(project, 'node_modules', 'minetokencraft'),
    bin: path.join(project, 'node_modules', '.bin', windows ? 'minetokencraft.cmd' : 'minetokencraft'),
  };
}

/**
 * A plain square PNG, enough for a skin.
 */
function plainPng(size, [red, green, blue]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => (bytes.reduce((c, byte) => table[(c ^ byte) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    const sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6], 8); // 8 bits per channel, RGBA
  const row = Buffer.from([0, ...Array.from({ length: size }, () => [red, green, blue, 255]).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Environment of an empty machine: a home folder with an unused Claude Code folder, its own settings and cache, and a
 * few plain skins in place of the downloaded ones, which come from the rate-limited Mojang API. Without skins the
 * village is not drawn; the missing textures only make /assets/ answer 404.
 */
function fakeEnv(name, port) {
  const base = path.join(work, `machine-${name}`);
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  const skins = path.join(base, 'cache', 'minetokencraft', 'assets', 'skins');
  fs.mkdirSync(skins, { recursive: true });
  const index = Array.from({ length: FAKE_SKINS }, (_, i) => ({ name: `Player${i}`, file: `Player${i}.png`, slim: false }));
  for (const [i, skin] of index.entries()) fs.writeFileSync(path.join(skins, skin.file), plainPng(64, [60 * i, 120, 200 - 40 * i]));
  fs.writeFileSync(path.join(skins, 'index.json'), JSON.stringify(index));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(base, 'config'),
    XDG_CACHE_HOME: path.join(base, 'cache'),
    LANG: 'en_US.UTF-8',
    MINETOKENCRAFT_PORT: String(port),
  };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

async function startServer(install, env, base) {
  let log = '';
  const server = spawn(process.execPath, [path.join(install.dir, 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  for (const started = Date.now(); Date.now() - started < START_TIMEOUT_MS; await sleep(200)) {
    if (server.exitCode !== null) break;
    if (await fetch(new URL('/api/settings', base)).then((response) => response.ok, () => false)) return server;
  }
  server.kill();
  throw new Error(`${install.name}: the server did not start\n${log}`);
}

async function get(base, pathname) {
  const response = await fetch(new URL(pathname, base));
  assert.equal(response.status, 200, `${pathname}: HTTP ${response.status}`);
  return response.text();
}

// Static imports, re-exports and dynamic imports written with a plain string.
const IMPORTS = /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]+?\s*from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Fetches both pages, their scripts and styles, and every module our scripts import, through the import map for
 * three.js. Returns how many files were served.
 */
async function checkPages(base) {
  const html = await get(base, '/');
  assert.match(await get(base, '/demo'), /<title>MineTokenCraft<\/title>/);
  const { imports } = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const resolve = (specifier, from) => {
    if (/^\.{0,2}\//.test(specifier)) return new URL(specifier, from).pathname;
    const key = Object.keys(imports).find((name) => name === specifier || (name.endsWith('/') && specifier.startsWith(name)));
    assert.ok(key, `${from}: no import map entry for ${specifier}`);
    return new URL(imports[key] + specifier.slice(key.length), base).pathname;
  };
  const queue = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map(([, src]) => new URL(src, base).pathname);
  const served = new Set();
  while (queue.length) {
    const pathname = queue.shift();
    if (served.has(pathname)) continue;
    served.add(pathname);
    const source = await get(base, pathname);
    // Only our own modules are read: three.js comes whole with its package.
    if (!pathname.startsWith('/js/')) continue;
    for (const [, specifier, dynamic] of source.matchAll(IMPORTS)) queue.push(resolve(specifier ?? dynamic, new URL(pathname, base).href));
  }
  // The state is empty until the server's first pass, slower on Windows.
  let state = {};
  for (const started = Date.now(); !state.players && Date.now() - started < START_TIMEOUT_MS; await sleep(200)) state = JSON.parse(await get(base, '/api/state'));
  assert.ok(Array.isArray(state.players), '/api/state: no players');
  return served.size;
}

async function waitFor(page, expression, what) {
  for (const started = Date.now(); Date.now() - started < START_TIMEOUT_MS; await sleep(200)) {
    if (await page.evaluate(expression).catch(() => false)) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Both pages in headless Chrome: the village, simple mode and the usage screen. Any exception, console error or
 * failed load fails, except those about the textures and fonts, which the server downloads in the background on a
 * first launch.
 */
async function checkInBrowser(base) {
  const { closeChrome, launchChrome, Page } = await import('./chrome.mjs');
  // GitHub's Linux runners do not let Chrome build its sandbox.
  const chrome = await launchChrome({ args: process.env.CI ? ['--no-sandbox'] : [] });
  const errors = [];
  try {
    const page = await Page.open(chrome);
    let current = '';
    const report = (text) => /(^|[\s/])assets\//.test(text) || errors.push(`${current}: ${text}`);
    page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report(exceptionDetails.exception?.description ?? exceptionDetails.text));
    page.on('Runtime.consoleAPICalled', ({ type, args }) => type === 'error' && report(`console.error ${args.map((arg) => arg.value ?? arg.description).join(' ')}`));
    page.on('Log.entryAdded', ({ entry }) => entry.level === 'error' && report(`${entry.text} ${entry.url ?? ''}`));
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.resize({ width: 1280, height: 800 });
    for (const pathname of ['/', '/demo']) {
      current = pathname;
      // The mark tells the new page from the one before, which also has `minetokencraft`.
      await page.evaluate('window.smokeOldPage = true');
      await page.send('Page.navigate', { url: new URL(pathname, base).href });
      await waitFor(page, '!window.smokeOldPage && window.minetokencraft?.state() != null', `${pathname} to start and get the state`);
      await sleep(2000);
      if (pathname === '/demo') assert.ok(await page.evaluate('minetokencraft.rooms().length > 0'), '/demo: no room in the village');
      await page.evaluate(`(() => { const toggle = document.getElementById('simple-toggle'); if (!toggle.checked) toggle.click(); return true; })()`);
      await sleep(1000);
      if (pathname === '/demo') assert.ok(await page.evaluate(`document.querySelectorAll('#dashboard .ui-item').length > 0`), '/demo: simple mode shows no session');
      await page.evaluate(`document.getElementById('simple-toggle').click(); document.getElementById('stats-toggle').click(); true`);
      await sleep(1000);
      await page.evaluate(`document.querySelector('#stats [data-close]').click(); true`);
      await sleep(500);
    }
  } catch (error) {
    if (errors.length) error.message += `\nerrors in the page:\n${errors.join('\n')}`;
    throw error;
  } finally {
    await closeChrome(chrome);
  }
  assert.deepEqual(errors, [], `errors in the page:\n${errors.join('\n')}`);
}

const servers = [];
try {
  const [{ filename }] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', work], root));
  const tarball = path.join(work, filename);
  console.log(`packed: ${filename}`);
  for (const [index, install] of [installGlobal(tarball), installHoisted(tarball)].entries()) {
    const port = 47000 + Math.floor(Math.random() * 2000) + index;
    const env = fakeEnv(index, port);
    const base = `http://127.0.0.1:${port}/`;
    assert.ok(run(install.bin, ['stop'], { env }).trim(), `${install.name}: the command printed nothing`);
    servers.push(await startServer(install, env, base));
    console.log(`${install.name}: command runs, ${await checkPages(base)} files served`);
    // The hoisted install is the one most likely to miss a file: it is the one opened in the browser.
    if (BROWSER && index === 1) {
      await checkInBrowser(base);
      console.log(`${install.name}: page, test page, simple mode and usage screen open without errors`);
    }
  }
} finally {
  for (const server of servers) server.kill();
  await sleep(300);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
