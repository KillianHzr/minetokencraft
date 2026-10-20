import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { appendJsonl, entries, fakeHome, MINUTE, writeJsonl } from './fixtures.mjs';

const { home } = fakeHome();
const { contextWindowOf, sessionCost, tasksOf, trackFile, usageStats } = await import('../lib/tracker.mjs');
const { requestCost } = await import('../lib/pricing.mjs');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const now = Date.now();
const projects = path.join(home, '.claude', 'projects', '-work-shop');
// One request of Opus 5.5 with 1M tokens of 1-hour cache writes: $8.
const write1h = { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } };

test('a request written several times while it streams is counted once, at its biggest', async () => {
  const file = path.join(projects, 'streamed.jsonl');
  writeJsonl(file, [
    entries.assistant(now, { id: 'msg_1', usage: { ...write1h, output_tokens: 10 } }),
    entries.assistant(now, { id: 'msg_1', usage: { ...write1h, output_tokens: 1e6 } }),
    entries.assistant(now, { id: 'msg_1', usage: { ...write1h, output_tokens: 10 } }),
  ]);
  await trackFile(file, 'claude', 'streamed');
  close(sessionCost('claude', 'streamed'), 8 + 20);
});

test('sub-agents add to their session, and a request copied into a resumed session counts once', async () => {
  const main = path.join(projects, 'parent.jsonl');
  const agent = path.join(projects, 'parent', 'subagents', 'agent-a1.jsonl');
  writeJsonl(main, [entries.assistant(now, { id: 'msg_main', usage: write1h })]);
  writeJsonl(agent, [entries.assistant(now, { id: 'msg_agent', model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 1e6 } })]);
  await trackFile(main, 'claude', 'parent');
  await trackFile(agent, 'claude', 'parent', true);
  close(sessionCost('claude', 'parent'), 8 + 1);
  // The resumed session copies the old request, then makes a new one.
  const resumed = path.join(projects, 'parent-resumed.jsonl');
  writeJsonl(resumed, [
    entries.assistant(now, { id: 'msg_main', usage: write1h }),
    entries.assistant(now + MINUTE, { id: 'msg_new', usage: { output_tokens: 1e6 } }),
  ]);
  await trackFile(resumed, 'claude', 'parent');
  close(sessionCost('claude', 'parent'), 8 + 1 + 20);
  const today = usageStats([{ id: 'claude' }], now).accounts.claude.at(-1);
  // Every file of this test so far, each request once: streamed (28), parent (8 + 1 + 20).
  close(today.cost, 28 + 29);
});

test('Claude Code\'s ledger prices unknown models, added up over every run of a resumed session', async () => {
  const file = path.join(projects, 'ledger.jsonl');
  writeJsonl(file, [
    entries.assistant(now, { id: 'msg_x', model: 'claude-future-1', usage: { input_tokens: 1e6 } }),
    entries.costState(2, { 'claude-future-1[1m]': 2 }),
    entries.costState(5, { 'claude-future-1[1m]': 5 }),
    // Resumed: the ledger starts again from zero.
    entries.costState(1, { 'claude-future-1[1m]': 1 }),
  ]);
  await trackFile(file, 'claude', 'ledger');
  close(sessionCost('claude', 'ledger'), 5 + 1);
  const stats = usageStats([{ id: 'claude' }], now).accounts.claude.at(-1);
  assert.ok(stats.unpriced >= 1e6, 'tokens of unknown models are reported apart');
});

test('the ledger wins when it is higher than the requests (calls the transcript does not show)', async () => {
  const file = path.join(projects, 'compacted.jsonl');
  writeJsonl(file, [
    entries.assistant(now, { id: 'msg_c', usage: { output_tokens: 1e6 } }),
    entries.costState(30, { 'claude-opus-5-5': 30 }),
  ]);
  await trackFile(file, 'claude', 'compacted');
  close(sessionCost('claude', 'compacted'), 30);
});

test('the context window is 1M for a [1m] model or a prompt past 200k, 200k otherwise', async () => {
  const file = path.join(projects, 'window.jsonl');
  writeJsonl(file, [entries.identity('claude-opus-5-5[1m]'), entries.assistant(now, { id: 'msg_w', usage: { input_tokens: 10 } })]);
  await trackFile(file, 'claude', 'window');
  assert.equal(contextWindowOf(file, 50_000), 1_000_000);
  assert.equal(contextWindowOf(path.join(projects, 'streamed.jsonl'), 50_000), 200_000);
  assert.equal(contextWindowOf(path.join(projects, 'streamed.jsonl'), 250_000), 1_000_000);
});

test('task lists follow TaskCreate and TaskUpdate, and only new lines are read', async () => {
  const file = path.join(projects, 'tasks.jsonl');
  writeJsonl(file, [
    entries.assistant(now, { id: 'msg_t1', content: [entries.toolUse('tu_1', 'TaskCreate', { subject: 'Write the tests', activeForm: 'Writing the tests' })] }),
    entries.toolResult(now, 'tu_1', 'Task #1 created successfully: Write the tests'),
  ]);
  await trackFile(file, 'claude', 'tasks');
  assert.deepEqual(tasksOf(file).map(({ subject, status }) => [subject, status]), [['Write the tests', 'pending']]);
  appendJsonl(file, [entries.assistant(now, { id: 'msg_t2', content: [entries.toolUse('tu_2', 'TaskUpdate', { taskId: '1', status: 'completed' })] })]);
  await trackFile(file, 'claude', 'tasks');
  assert.equal(tasksOf(file)[0].status, 'completed');
});

test('usage is bucketed by local hour over the last 7 days', async () => {
  const yesterday = new Date(now - 24 * 60 * MINUTE);
  yesterday.setHours(9, 30);
  const file = path.join(projects, 'yesterday.jsonl');
  writeJsonl(file, [entries.assistant(yesterday.getTime(), { id: 'msg_y', usage: { output_tokens: 500 } })]);
  await trackFile(file, 'claude', 'yesterday');
  const stats = usageStats([{ id: 'claude' }], now);
  assert.equal(stats.days.length, 7);
  const day = stats.accounts.claude.at(-2);
  assert.equal(day.hours[9].tokens, 500);
  close(day.hours[9].cost, requestCost('claude-opus-5-5', { input: 0, output: 500, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 }));
  assert.equal(day.sessions, 1);
});
