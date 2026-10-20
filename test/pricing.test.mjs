import assert from 'node:assert/strict';
import test from 'node:test';
import { isPriced, modelKey, partsTokens, requestCost, requestParts } from '../lib/pricing.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('model ids lose their date, provider and context variant', () => {
  assert.equal(modelKey('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
  assert.equal(modelKey('claude-opus-5[1m]'), 'claude-opus-5');
  assert.equal(modelKey('anthropic/claude-haiku-4-5'), 'claude-haiku-4-5');
  assert.ok(isPriced('claude-opus-5-5'));
  assert.ok(!isPriced('claude-unknown-9'));
});

test('cache writes are split between the 5-minute and the 1-hour cache', () => {
  const parts = requestParts({
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 300,
    cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 100 },
  });
  assert.deepEqual(parts, { input: 10, output: 20, cacheRead: 1000, write5m: 100, write1h: 200, webSearches: 0 });
  assert.equal(partsTokens(parts), 1330);
});

test('without the split, cache writes count as 5-minute writes', () => {
  const parts = requestParts({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 500 });
  assert.equal(parts.write5m, 500);
  assert.equal(parts.write1h, 0);
});

test('a request is priced from its parts, the 1-hour cache at twice the input price', () => {
  // Opus 5.5: $4 input, $20 output, $0.20 cache read per million tokens.
  const cost = requestCost('claude-opus-5-5', { input: 1e6, output: 1e6, cacheRead: 1e6, write5m: 1e6, write1h: 1e6, webSearches: 2 });
  close(cost, 4 + 20 + 0.2 + 4 * 1.25 + 4 * 2 + 0.02);
});

test('Sonnet 4.5 costs more past 200k tokens of prompt', () => {
  const short = requestCost('claude-sonnet-4-5-20250929', { input: 100_000, output: 1000, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 });
  const long = requestCost('claude-sonnet-4-5-20250929', { input: 300_000, output: 1000, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 });
  close(short, 0.3 + 0.015);
  close(long, 0.9 * 2 + 0.015 * 1.5);
});

test('an unknown model has no price rather than a guessed one', () => {
  assert.equal(requestCost('claude-unknown-9', { input: 1, output: 1, cacheRead: 0, write5m: 0, write1h: 0, webSearches: 0 }), null);
});
