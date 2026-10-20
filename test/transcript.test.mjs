import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { entries, fakeHome, MINUTE, writeJsonl } from './fixtures.mjs';

const { root, cache } = fakeHome();
const { sessionHistory, summarizeTranscript } = await import('../lib/transcript.mjs');
const { saveStatusline } = await import('../scripts/statusline.mjs');

const now = Date.now();
const file = path.join(root, 'session.jsonl');
writeJsonl(file, [
  entries.title('Fix the payment sync'),
  entries.user(now - 5 * MINUTE, 'Payments stopped syncing'),
  entries.user(now - 5 * MINUTE, '<command-name>/clear</command-name>'),
  entries.assistant(now - 4 * MINUTE, { id: 'msg_1', content: [entries.toolUse('tu_1', 'Read', { file_path: 'C:\\shop\\src\\webhook.ts' })] }),
  entries.toolResult(now - 4 * MINUTE, 'tu_1', 'file contents'),
  entries.assistant(now - 3 * MINUTE, { id: 'msg_2', usage: { input_tokens: 10, cache_read_input_tokens: 80_000 }, content: [{ type: 'text', text: 'The webhook fires too early.' }] }),
  entries.assistant(now - MINUTE, { id: 'msg_3', usage: { input_tokens: 10, cache_read_input_tokens: 90_000 },
    content: [entries.toolUse('tu_2', 'TaskUpdate', { taskId: '3', status: 'completed' })] }),
  entries.assistant(now - 30_000, { id: 'msg_s', sidechain: true, usage: { input_tokens: 5 } }),
]);

test('a transcript sums up into a title, the last messages, the open tool and the context', async () => {
  const summary = await summarizeTranscript(file, fs.statSync(file), 1 << 20);
  assert.equal(summary.title, 'Fix the payment sync');
  assert.equal(summary.lastPrompt, 'Payments stopped syncing');
  assert.equal(summary.lastText, 'The webhook fires too early.');
  // The last request of the conversation, not the sub-agent's logged after it in the same file.
  assert.equal(summary.contextTokens, 90_010);
  assert.deepEqual(summary.tool, { name: 'TaskUpdate', label: '', taskId: '3', taskStatus: 'completed' });
});

test('the history lists prompts, answers and tools, oldest first', async () => {
  const history = await sessionHistory(file);
  assert.deepEqual(history.map((event) => event.kind), ['prompt', 'tool', 'text', 'tool']);
  assert.equal(history[1].text, 'webhook.ts');
  assert.equal(history.at(-1).taskId, '3');
});

test('the status line copy goes to the folder of its account', async () => {
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'home', '.claude-work');
  await saveStatusline(JSON.stringify({ session_id: 'abc-123', cost: { total_cost_usd: 1 } }));
  assert.ok(fs.existsSync(path.join(cache, 'statusline', 'claude-work', 'abc-123.json')));
  // A session id that could escape the folder is ignored.
  await saveStatusline(JSON.stringify({ session_id: '../../evil' }));
  assert.ok(!fs.existsSync(path.join(cache, 'evil.json')));
});
