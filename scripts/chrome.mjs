// Headless Chrome driven over the DevTools Protocol, for the maintainer scripts (captures, package test). For
// maintainers only: it is not part of the npm package.
// Needs Google Chrome or Chromium (CHROME_PATH to point at another one).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal Chrome DevTools Protocol client over the page WebSocket.
 */
export class Page {
  static async open(chrome) {
    const port = await chromePort(chrome.profile);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = new this(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await page.ready;
    return page;
  }

  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve) => this.socket.addEventListener('open', resolve, { once: true }));
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  /**
   * Calls the listener on every event of this name (enable its domain first, `Runtime.enable` for instance).
   */
  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async resize({ width, height }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  async shoot(file, { format = 'jpeg', quality = 88 } = {}) {
    const { data } = await this.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined });
    await fs.writeFile(file, Buffer.from(data, 'base64'));
  }

  async hover(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }
}

async function chromePort(profile) {
  for (let i = 0; i < 100; i++) {
    const file = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null);
    if (file) return Number(file.split('\n')[0]);
    await sleep(100);
  }
  throw new Error('Chrome did not open its DevTools port');
}

export async function launchChrome({ args = [] } = {}) {
  const binary = (await Promise.all(CHROME_PATHS.map(async (file) => (await fs.access(file).then(() => file, () => null))))).find(Boolean);
  if (!binary) throw new Error('Chrome not found: set CHROME_PATH');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'minetokencraft-chrome-'));
  const child = spawn(binary, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--lang=en-US', '--enable-unsafe-swiftshader', ...args, 'about:blank',
  ], { stdio: 'ignore' });
  return { child, profile };
}

export async function closeChrome(chrome) {
  chrome.child.kill();
  await sleep(300);
  await fs.rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
}
