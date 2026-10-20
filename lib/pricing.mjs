// What a request would cost at Anthropic's list prices (API equivalent: a subscription pays differently, but this
// is the cost Claude Code itself shows). Per million tokens: base input, output and cache read. Cache writes follow
// the input price: 1.25 times for the 5-minute cache, 2 times for the 1-hour cache (Claude Code uses the 1-hour one).
// Prices from https://docs.anthropic.com/en/docs/about-claude/pricing; a model missing here is not guessed: its cost
// comes from Claude Code's own ledger in the transcript, when there is one.

const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, longContext: true },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, longContext: true },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08 },
};
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
// Sonnet 4 and 4.5 with the 1M window: past 200k tokens of prompt, input costs twice as much and output 1.5 times.
const LONG_CONTEXT_TOKENS = 200_000;
const LONG_CONTEXT = { input: 2, output: 1.5 };
// Web search, billed per request on top of tokens.
const WEB_SEARCH_USD = 0.01;
const MILLION = 1_000_000;

/**
 * Price key of a model id: `claude-sonnet-4-5-20250929` and `claude-opus-5[1m]` become `claude-sonnet-4-5` and
 * `claude-opus-5`.
 */
export function modelKey(model) {
  return String(model ?? '').toLowerCase().replace(/^(anthropic\/|us\.anthropic\.|anthropic\.)/, '').replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}(-v\d+(:\d+)?)?$/, '').replace(/-latest$/, '');
}

export function isPriced(model) {
  return modelKey(model) in PRICES;
}

/**
 * Token counts of one request, from the `usage` of an assistant message. Cache writes are split between the
 * 5-minute and the 1-hour cache when the transcript says so, otherwise counted as 5-minute writes.
 */
export function requestParts(usage) {
  const written = usage.cache_creation_input_tokens ?? 0;
  const split = usage.cache_creation;
  const write1h = split ? split.ephemeral_1h_input_tokens ?? 0 : 0;
  const write5m = split ? split.ephemeral_5m_input_tokens ?? Math.max(0, written - write1h) : written;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    write5m,
    write1h,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}

export function partsTokens(parts) {
  return parts.input + parts.output + parts.cacheRead + parts.write5m + parts.write1h;
}

/**
 * Cost of one request in dollars, or null for a model this table does not know.
 */
export function requestCost(model, parts) {
  const price = PRICES[modelKey(model)];
  if (!price) return null;
  const prompt = parts.input + parts.cacheRead + parts.write5m + parts.write1h;
  const long = price.longContext && prompt > LONG_CONTEXT_TOKENS;
  const inputRate = (price.input / MILLION) * (long ? LONG_CONTEXT.input : 1);
  const readRate = (price.cacheRead / MILLION) * (long ? LONG_CONTEXT.input : 1);
  const outputRate = (price.output / MILLION) * (long ? LONG_CONTEXT.output : 1);
  return parts.input * inputRate
    + parts.write5m * inputRate * CACHE_WRITE_5M
    + parts.write1h * inputRate * CACHE_WRITE_1H
    + parts.cacheRead * readRate
    + parts.output * outputRate
    + parts.webSearches * WEB_SEARCH_USD;
}
