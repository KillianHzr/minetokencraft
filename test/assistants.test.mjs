import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fakeHome, MINUTE, writeJsonl } from './fixtures.mjs';

const { home } = fakeHome();
const now = Date.now();
const iso = (at) => new Date(at).toISOString();
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });

// A Codex session in the middle of a turn, running a command, with an update_plan and the account's rate limits;
// and a sub-agent rollout naming it as its parent.
const day = new Date(now);
const codexDir = path.join(home, '.codex', 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
const event = (at, type, payload) => ({ timestamp: iso(at), type, payload });
const tokens = (at, input, cached, output) => event(at, 'event_msg', {
  type: 'token_count',
  info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }, model_context_window: 258400 },
  rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_at: Math.floor((now + 3600e3) / 1000) }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: Math.floor((now + 86400e3) / 1000) }, plan_type: 'plus' },
});
writeJsonl(path.join(codexDir, 'rollout-a.jsonl'), [
  event(now - 10 * MINUTE, 'session_meta', { id: 'cx-1', cwd: '/srv/api', source: 'cli', timestamp: iso(now - 10 * MINUTE) }),
  event(now - 10 * MINUTE, 'turn_context', { model: 'gpt-5.5', cwd: '/srv/api' }),
  event(now - 9 * MINUTE, 'event_msg', { type: 'user_message', message: 'Fix the flaky test' }),
  event(now - 9 * MINUTE, 'event_msg', { type: 'task_started' }),
  event(now - 8 * MINUTE, 'response_item', { type: 'function_call', name: 'update_plan', call_id: 'c1', arguments: JSON.stringify({ plan: [{ step: 'Find it', status: 'completed' }, { step: 'Fix it', status: 'in_progress' }] }) }),
  event(now - 8 * MINUTE, 'response_item', { type: 'function_call_output', call_id: 'c1' }),
  event(now - 7 * MINUTE, 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch' }),
  event(now - 7 * MINUTE, 'response_item', { type: 'custom_tool_call_output', call_id: 'c2' }),
  tokens(now - 6 * MINUTE, 1_000_000, 0, 0),
  event(now - MINUTE, 'response_item', { type: 'function_call', name: 'exec', call_id: 'c3', arguments: JSON.stringify({ command: ['npm', 'test'] }) }),
]);
writeJsonl(path.join(codexDir, 'rollout-b.jsonl'), [
  event(now - 5 * MINUTE, 'session_meta', { id: 'cx-2', parent_thread_id: 'cx-1', cwd: '/srv/api', timestamp: iso(now - 5 * MINUTE) }),
  event(now - 5 * MINUTE, 'event_msg', { type: 'user_message', message: 'Look for the race condition' }),
  event(now - 5 * MINUTE, 'event_msg', { type: 'task_started' }),
]);
// A Gemini CLI session waiting for Gemini's answer.
writeJsonl(path.join(home, '.gemini', 'tmp', 'abc123', 'chats', 'session-1.jsonl'), [
  { type: 'session_metadata', sessionId: 'gm-1', startTime: iso(now - 3 * MINUTE) },
  { type: 'user', id: 'm1', timestamp: iso(now - 3 * MINUTE), content: [{ text: 'Summarize the logs' }] },
  { type: 'gemini', id: 'm2', timestamp: iso(now - 2 * MINUTE), model: 'gemini-2.5-pro', content: [{ text: 'Reading them.' }], tokens: { input: 1000, output: 50, cached: 600, thoughts: 30, tool: 20, total: 1100 } },
  { type: 'message_update', id: 'm2', tokens: { input: 1000, output: 100, cached: 600, thoughts: 30, tool: 20, total: 1150 } },
  { type: 'user', id: 'm3', timestamp: iso(now - MINUTE), content: [{ text: 'And the errors?' }] },
]);

const { allAccounts } = await import('../lib/accounts.mjs');
const { collectState } = await import('../lib/sessions.mjs');
const { usageStats } = await import('../lib/tracker.mjs');

test('Codex and Gemini CLI get a wing each, after the Claude Code accounts', async () => {
  const accounts = await allAccounts({ fresh: true });
  assert.deepEqual(accounts.map((account) => [account.id, account.tool, account.slot]), [['claude', 'claude', 0], ['codex', 'codex', 1], ['gemini', 'gemini', 2]]);
});

test('a Codex session is a player: working on its command, its plan as tasks, its sub-agent as a villager', async () => {
  const state = await collectState({ alive: new Set() });
  const player = state.players.find((candidate) => candidate.account === 'codex');
  assert.equal(player.name, 'Fix the flaky test');
  assert.equal(player.status, 'working');
  assert.deepEqual(player.tool, { name: 'Bash', label: '' });
  assert.equal(player.project, 'api');
  assert.deepEqual([player.tasks.done, player.tasks.total, player.tasks.current], [1, 2, 'Fix it']);
  assert.deepEqual(player.context, { tokens: 1_000_000, size: 258400, pct: 387 });
  // 1M tokens of input at $5 per million for GPT-5.5, past 272k so doubled.
  assert.equal(player.costUSD, 10);
  assert.equal(player.work.edits, 1);
  assert.deepEqual(player.villagers.map((villager) => [villager.description, villager.status]), [['Look for the race condition', 'working']]);
  const codex = state.accounts.find((account) => account.id === 'codex');
  assert.equal(codex.usage.fiveHour.usedPct, 42);
  assert.equal(codex.usage.sevenDay.usedPct, 12);
  assert.equal(codex.plan, 'Plus');
});

test('a Gemini CLI session waiting for its answer works, with its tokens priced', async () => {
  const state = await collectState({ alive: new Set() });
  const player = state.players.find((candidate) => candidate.account === 'gemini');
  assert.equal(player.name, 'Summarize the logs');
  assert.equal(player.status, 'working');
  assert.equal(player.lastPrompt, 'And the errors?');
  assert.equal(player.lastText, 'Reading them.');
  // The update wins: input 420 at $1.25, cache 600 at $0.125, output 130 at $10, per million.
  assert.ok(Math.abs(player.costUSD - (420 * 1.25 + 600 * 0.125 + 130 * 10) / 1e6) < 1e-12);
});

test('their tokens count in the usage of the day', async () => {
  const today = usageStats([{ id: 'codex' }, { id: 'gemini' }], now).accounts;
  assert.equal(today.codex.at(-1).tokens, 1_000_000);
  assert.equal(today.gemini.at(-1).tokens, 1150);
  assert.equal(today.codex.at(-1).agents, 1);
});
