import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { entries, fakeHome, MINUTE, session, writeJson } from './fixtures.mjs';

const { home, cache } = fakeHome();
const now = Date.now();
const claude = path.join(home, '.claude');
const work = path.join(home, '.claude-work');
const write1h = { cache_read_input_tokens: 150_000, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 } };

// A session at work with a running tool and two sub-agents, one waiting for you, one done, one dead.
session(claude, {
  pid: 101, sessionId: 'aaaa-1', cwd: '/srv/shop/api', status: 'busy', at: now - 5 * MINUTE,
  transcript: [
    entries.title('Fix the payment sync'),
    entries.user(now - 4 * MINUTE, 'Payments stopped syncing'),
    entries.assistant(now - 3 * MINUTE, { id: 'msg_a1', usage: { ...write1h, input_tokens: 5, output_tokens: 300 } }),
    entries.assistant(now - MINUTE, { id: 'msg_a2', usage: { ...write1h, input_tokens: 20, output_tokens: 100 },
      content: [entries.toolUse('tu_bash', 'Bash', { command: 'npm test', description: 'Run the tests' })] }),
  ],
  agents: [
    { id: 'ag1', type: 'Explore', description: 'Find the webhook calls', transcript: [entries.assistant(now - 30_000, { id: 'msg_g1', usage: { output_tokens: 10 },
      content: [entries.toolUse('tu_grep', 'Grep', { pattern: 'syncPayment' })] })] },
    { id: 'ag2', type: 'Plan', description: 'Plan the fix', transcript: [entries.assistant(now - 2 * MINUTE, { id: 'msg_g2', usage: { output_tokens: 10 },
      content: [entries.toolUse('tu_hand', 'SubagentHandback', {})] })] },
  ],
});
session(work, {
  pid: 202, sessionId: 'bbbb-2', cwd: '/home/me/blog/main', status: 'waiting', waitingFor: 'input needed', at: now - 2 * MINUTE,
  transcript: [entries.assistant(now - 2 * MINUTE, { id: 'msg_b1', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'Shall I push?' }] })],
});
session(work, {
  pid: 203, sessionId: 'cccc-3', cwd: '/home/me/notes', status: 'idle', at: now - 10 * MINUTE,
  transcript: [entries.assistant(now - 10 * MINUTE, { id: 'msg_c1', usage: { output_tokens: 10 } })],
});
session(work, { pid: 999, sessionId: 'dead-4', cwd: '/home/me/old', status: 'busy', at: now - MINUTE });
// The status line copy of the waiting session: its cost is higher than the transcript's (calls not logged there).
writeJson(path.join(cache, 'statusline', 'claude-work', 'bbbb-2.json'), { session_id: 'bbbb-2', cost: { total_cost_usd: 3.5 } });

const { collectState } = await import('../lib/sessions.mjs');

async function snapshot() {
  // The first pass reads the transcripts; the second sees them complete.
  await collectState({ alive: new Set([101, 202, 203]) });
  return collectState({ alive: new Set([101, 202, 203]) });
}

test('live sessions become players, dead ones are left out', async () => {
  const state = await snapshot();
  assert.deepEqual(state.players.map((player) => player.id).sort(), ['claude-work:202', 'claude-work:203', 'claude:101']);
  assert.deepEqual(state.accounts.map((account) => [account.id, account.slot]), [['claude', 0], ['claude-work', 1]]);
});

test('a player tells what it does: title, status, tool, project, context and cost', async () => {
  const player = (await snapshot()).players.find((candidate) => candidate.id === 'claude:101');
  assert.equal(player.name, 'Fix the payment sync');
  assert.equal(player.status, 'working');
  assert.equal(player.project, 'api');
  assert.deepEqual(player.tool, { name: 'Bash', label: 'Run the tests' });
  assert.deepEqual(player.context, { tokens: 151_020, size: 200_000, pct: 76 });
  assert.ok(player.costUSD > 0);
});

test('sub-agents are villagers, working or done', async () => {
  const player = (await snapshot()).players.find((candidate) => candidate.id === 'claude:101');
  const villagers = Object.fromEntries(player.villagers.map((villager) => [villager.type, villager]));
  assert.equal(villagers.Explore.status, 'working');
  assert.equal(villagers.Explore.tool.name, 'Grep');
  assert.equal(villagers.Explore.description, 'Find the webhook calls');
  assert.equal(villagers.Plan.status, 'done');
});

test('a waiting session says what it waits for, and keeps the higher cost', async () => {
  const state = await snapshot();
  const waiting = state.players.find((candidate) => candidate.id === 'claude-work:202');
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.waitingFor, 'input needed');
  assert.equal(waiting.lastText, 'Shall I push?');
  assert.equal(waiting.project, 'blog/main');
  assert.equal(waiting.costUSD, 3.5);
  assert.equal(state.players.find((candidate) => candidate.id === 'claude-work:203').status, 'done');
});
