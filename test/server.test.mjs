import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fakeHome } from './fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { home } = fakeHome();
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
const port = 47000 + Math.floor(Math.random() * 2000);
const server = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, MINETOKENCRAFT_PORT: String(port) }, stdio: 'pipe' });
test.after(() => server.kill());

/**
 * Raw request, so the Host header can be anything.
 */
function request(pathname, { method = 'GET', host = `localhost:${port}`, type, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: host, ...(type ? { 'Content-Type': type } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test.before(async () => {
  for (let i = 0; i < 100; i++) {
    if (await request('/api/settings').then(() => true, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the server did not start');
});

test('the page, the test page and three.js are served', async () => {
  for (const pathname of ['/', '/demo']) {
    const page = await request(pathname);
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>MineTokenCraft<\/title>/);
  }
  assert.equal((await request('/js/main.js')).status, 200);
  assert.equal((await request('/vendor/three/build/three.module.js')).status, 200);
});

test('the state is JSON, with the accounts found in the home folder', async () => {
  let state = {};
  for (let i = 0; i < 50 && !state.accounts; i++) {
    state = JSON.parse((await request('/api/state')).text);
    if (!state.accounts) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(state.accounts.map((account) => account.id), ['claude']);
  assert.deepEqual(state.players, []);
});

test('the page forbids anything it does not load itself', async () => {
  const page = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: `localhost:${port}` } }, resolve));
  page.resume();
  const policy = page.headers['content-security-policy'];
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self' 'sha256-[\w+/=]+'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
});

test('a request for another host is refused (DNS rebinding)', async () => {
  assert.equal((await request('/api/state', { host: 'evil.example:4747' })).status, 421);
});

test('settings only change through JSON, which another website cannot send', async () => {
  await request('/api/settings', { method: 'POST', type: 'text/plain', body: '{"language":"fr"}' });
  assert.equal(JSON.parse((await request('/api/settings')).text).language, '');
  const saved = JSON.parse((await request('/api/settings', { method: 'POST', type: 'application/json', body: '{"language":"fr"}' })).text);
  assert.equal(saved.language, 'fr');
  const refused = await request('/api/settings', { method: 'POST', type: 'application/json', body: '{"accounts":{"claude":{"sessionKey":"nope"}}}' });
  assert.equal(refused.status, 400);
  assert.equal(JSON.parse(refused.text).code, 'sessionKeyFormat');
});

test('files outside the page cannot be read', async () => {
  for (const pathname of ['/../package.json', '/%2e%2e/package.json', '/js/..%2f..%2fpackage.json', '/assets/..%2f..%2fconfig%2fsettings.json']) {
    assert.ok([403, 404].includes((await request(pathname)).status), pathname);
  }
});

test('unknown sessions get a 404', async () => {
  assert.equal((await request('/api/history/nobody')).status, 404);
  assert.equal((await request('/api/focus/nobody', { method: 'POST', type: 'application/json', body: '{}' })).status, 404);
});
