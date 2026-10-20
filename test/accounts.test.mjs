import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fakeHome, writeJson } from './fixtures.mjs';

const { home, root } = fakeHome();
// Three config folders that have been used, one that never was, one outside the home given by CLAUDE_CONFIG_DIR.
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude-work', 'sessions'), { recursive: true });
writeJson(path.join(home, '.claude_perso', '.credentials.json'), {});
fs.mkdirSync(path.join(home, '.claude-empty'), { recursive: true });
fs.mkdirSync(path.join(root, 'elsewhere', 'Team Config', 'projects'), { recursive: true });
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'elsewhere', 'Team Config');

const { accountIdFor, allAccounts, listAccounts } = await import('../lib/accounts.mjs');
const { updateSettings } = await import('../lib/settings.mjs');

test('an account id comes from its folder name', () => {
  assert.equal(accountIdFor('/home/someone/.claude'), 'claude');
  assert.equal(accountIdFor('/home/someone/.claude-work'), 'claude-work');
  assert.equal(accountIdFor('C:\\Users\\someone\\.claude_perso'), 'claude_perso');
  assert.equal(accountIdFor('/srv/Team Config'), 'team-config');
});

test('every used config folder is found, the default one first', async () => {
  const accounts = await allAccounts({ fresh: true });
  assert.deepEqual(accounts.map((account) => account.id), ['claude', 'team-config', 'claude-work', 'claude_perso']);
  assert.deepEqual(accounts.map((account) => account.slot), [0, 1, 2, 3]);
});

test('a hidden account keeps its settings but leaves the village, and the others close the gap', async () => {
  await updateSettings({ accounts: { 'team-config': { hidden: true, label: 'team' } } });
  const accounts = await allAccounts({ fresh: true });
  const team = accounts.find((account) => account.id === 'team-config');
  assert.equal(team.label, 'team');
  assert.equal(team.hidden, true);
  assert.deepEqual((await listAccounts()).map((account) => [account.id, account.slot]), [['claude', 0], ['claude-work', 1], ['claude_perso', 2]]);
});

test('a folder added by hand is found, with ~ for the home folder', async () => {
  fs.mkdirSync(path.join(home, 'other', 'projects'), { recursive: true });
  await updateSettings({ addDir: '~/other' });
  assert.ok((await allAccounts({ fresh: true })).some((account) => account.id === 'other'));
  await updateSettings({ removeDir: '~/other' });
  assert.ok(!(await allAccounts({ fresh: true })).some((account) => account.id === 'other'));
});
