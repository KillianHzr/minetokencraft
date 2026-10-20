import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fakeHome, writeJson } from './fixtures.mjs';

const { home } = fakeHome();
const TOKEN = 'test-oauth-token';
const SESSION_KEY = `sk-ant-sid01-${'b'.repeat(40)}`;
// Account with a Claude Code login in its folder, and one without (it will use a claude.ai session key).
writeJson(path.join(home, '.claude', '.credentials.json'), {
  claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600e3, subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
});
fs.mkdirSync(path.join(home, '.claude-web', 'projects'), { recursive: true });

// Every call the code makes goes through this fake network.
const calls = [];
let answer = () => new Response('{}', { status: 500 });
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), headers: options.headers ?? {} });
  return answer(String(url), options);
};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const resetsAt = new Date(Date.now() + 3600e3).toISOString();

const { limitsFor, refreshLimits } = await import('../lib/limits.mjs');
const { accountsOverview } = await import('../lib/accounts.mjs');
const { updateSettings } = await import('../lib/settings.mjs');

test('quotas come from Anthropic with the Claude Code login, and the token never shows', async () => {
  answer = () => json({ five_hour: { utilization: 42, resets_at: resetsAt }, seven_day: { utilization: 7, resets_at: resetsAt } });
  await refreshLimits('claude');
  const limits = limitsFor('claude');
  assert.equal(limits.source, 'oauth');
  assert.equal(limits.plan, 'Max 5x');
  assert.equal(limits.usage.fiveHour.usedPct, 42);
  assert.equal(limits.usage.sevenDay.resetsAt, Date.parse(resetsAt));
  const call = calls.at(-1);
  assert.equal(call.url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!JSON.stringify(await accountsOverview()).includes(TOKEN));
});

test('too many requests gives a code the page can word, and keeps the last quotas', async () => {
  answer = () => json({}, 429, { 'retry-after': '120' });
  await refreshLimits('claude');
  const limits = limitsFor('claude');
  assert.deepEqual(limits.error, { code: 'tooManyRequests', status: 429 });
  assert.equal(limits.usage.fiveHour.usedPct, 42);
});

test('without a login, a claude.ai session key is used, with the organization of the account', async () => {
  await updateSettings({ accounts: { 'claude-web': { sessionKey: SESSION_KEY } } });
  answer = (url) => (url.endsWith('/organizations')
    ? json([{ uuid: 'org-api', capabilities: ['api'] }, { uuid: 'org-chat', capabilities: ['chat'] }])
    : json({ five_hour: { utilization: 15, resets_at: resetsAt }, seven_day: { utilization: 60, resets_at: resetsAt } }));
  await refreshLimits('claude-web');
  const limits = limitsFor('claude-web');
  assert.equal(limits.source, 'sessionKey');
  assert.equal(limits.usage.sevenDay.usedPct, 60);
  assert.ok(calls.at(-1).url.endsWith('/organizations/org-chat/usage'));
  assert.equal(calls.at(-1).headers.Cookie, `sessionKey=${SESSION_KEY}`);
  assert.ok(!JSON.stringify(await accountsOverview()).includes(SESSION_KEY));
});

test('an expired session key and a Cloudflare block are told apart', async () => {
  answer = () => json({ error: 'invalid' }, 401);
  await refreshLimits('claude-web');
  assert.equal(limitsFor('claude-web').error.code, 'sessionKeyInvalid');
  answer = () => new Response('<html>', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  await refreshLimits('claude-web');
  assert.equal(limitsFor('claude-web').error.code, 'cloudflare');
});
