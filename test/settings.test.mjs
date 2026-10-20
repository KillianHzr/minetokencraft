import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fakeHome } from './fixtures.mjs';

const { config } = fakeHome();
const { getSettings, publicSettings, updateSettings } = await import('../lib/settings.mjs');
const KEY = `sk-ant-sid01-${'a'.repeat(40)}`;

test('notifications are off until asked for', async () => {
  assert.equal((await getSettings()).notifications, false);
});

test('a session key is saved, never shown back, and kept in a file only the user can read', async () => {
  await updateSettings({ accounts: { claude: { sessionKey: KEY } } });
  const shown = await publicSettings();
  assert.equal(shown.accounts.claude.hasSessionKey, true);
  assert.ok(!JSON.stringify(shown).includes(KEY));
  const file = path.join(config, 'settings.json');
  assert.ok(fs.readFileSync(file, 'utf8').includes(KEY));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await updateSettings({ accounts: { claude: { sessionKey: null } } });
  assert.equal((await publicSettings()).accounts.claude.hasSessionKey, false);
});

test('anything that is not a session key is refused, with a code the page can word', async () => {
  await assert.rejects(updateSettings({ accounts: { claude: { sessionKey: 'hello' } } }), { code: 'sessionKeyFormat' });
});

test('fields are checked one by one, and unknown ones are ignored', async () => {
  await updateSettings({
    language: 'fr', city: `  ${'x'.repeat(200)}  `, notifications: 'yes', accounts: { 'Not An Id!': { label: 'x' }, claude: { label: ' work ', keychain: true } }, extra: 1,
  });
  const settings = await getSettings();
  assert.equal(settings.language, 'fr');
  assert.equal(settings.city.length, 80);
  assert.equal(settings.notifications, false);
  assert.equal(settings.accounts['Not An Id!'], undefined);
  assert.equal(settings.accounts.claude.label, 'work');
  assert.equal(settings.accounts.claude.keychain, true);
  assert.equal(settings.extra, undefined);
  await updateSettings({ language: 'klingon' });
  assert.equal((await getSettings()).language, 'fr');
});
