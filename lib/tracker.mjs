import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isPriced, modelKey, partsTokens, requestCost, requestParts } from './pricing.mjs';

// Incremental reading of transcripts: each file is read once, then only what gets appended to it. From them we get
// each session's task list, its cost and its context window, and the tokens and cost of the last days hour by hour.
//
// Every request is counted once: Claude Code writes one request as several entries, writes it again while the output
// streams in, and copies it into another file when a session is resumed or forked. Requests are keyed by message id
// and request id, and the biggest copy wins (the one with the full output).

const CHUNK_BYTES = 4 * 1024 * 1024;
// Files tracked: those touched in the last 8 days, enough for the week view.
const RECENT_MS = 8 * 24 * 60 * 60 * 1000;
const STATS_DAYS = 7;
const TASK_CREATED = /Task #(\d+) created/;
// Tools that write files: each call fills the session's chests a little more.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Bookkeeping tools are not "used tools" worth framing on the wall.
const UNFRAMED_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'SubagentHandback']);
const FRAMED_TOOLS = 2;
// Context windows: 200k tokens, 1M for the `[1m]` variants.
const WINDOW = 200_000;
const WINDOW_1M = 1_000_000;
// Only these lines are worth parsing; the others (tool results, file contents) are skipped without JSON.parse.
const USEFUL_LINE = /"type":"assistant"|"cost-state"|"(TaskCreate|TaskUpdate|TodoWrite)"|Task #\d+ created|"identity":/;

const files = new Map();
// Every request seen, by `${message.id}|${requestId}`: { account, at, tokens, cost, model }.
const requests = new Map();
// Files of each session (its transcript and its sub-agents'), by `${account}:${sessionId}`.
const sessions = new Map();

function localDay(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function newState(account, sessionId, subagent) {
  return {
    account,
    sessionId,
    subagent,
    offset: 0,
    // Bumped whenever the file adds or grows a request: session costs are recomputed only then.
    version: 0,
    keys: new Set(),
    pendingTasks: new Map(),
    tasks: new Map(),
    // Calls per tool, keyed by tool_use id so a request written twice counts once.
    toolUses: new Map(),
    firstAt: null,
    // Model of the session, as Claude Code announces it (`claude-opus-5[1m]`).
    modelId: null,
    // Claude Code's own cost ledger: it starts again from zero when a session is resumed, so each run is added up.
    ledger: { closed: new Map(), current: new Map(), lastTotal: 0 },
    reading: null,
  };
}

function taskFromInput(input) {
  return { subject: input.subject ?? input.content ?? '', activeForm: input.activeForm ?? '' };
}

function handleBlocks(state, entry) {
  const content = entry.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === 'tool_use') {
      if (block.id && block.name) state.toolUses.set(block.id, block.name);
      const input = block.input ?? {};
      if (block.name === 'TaskCreate') state.pendingTasks.set(block.id, taskFromInput(input));
      else if (block.name === 'TaskUpdate' && input.taskId != null) {
        const task = state.tasks.get(String(input.taskId));
        if (!task) continue;
        if (input.status === 'deleted') state.tasks.delete(String(input.taskId));
        else Object.assign(task, input.status ? { status: input.status } : {}, input.subject ? { subject: input.subject } : {},
          input.activeForm ? { activeForm: input.activeForm } : {});
      } else if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
        // Old list tool: it rewrites the whole list every time.
        state.tasks = new Map(input.todos.map((todo, index) => [String(index + 1), { ...taskFromInput(todo), status: todo.status ?? 'pending' }]));
      }
    } else if (block.type === 'tool_result' && state.pendingTasks.has(block.tool_use_id)) {
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      const match = text.match(TASK_CREATED);
      if (match) state.tasks.set(match[1], { ...state.pendingTasks.get(block.tool_use_id), status: 'pending' });
      state.pendingTasks.delete(block.tool_use_id);
    }
  }
}

/**
 * One request of the file: kept if it is new, or if this copy is bigger than the one already seen.
 */
function recordRequest(state, entry, at) {
  const { message } = entry;
  const key = `${message.id}|${entry.requestId ?? ''}`;
  const parts = requestParts(message.usage);
  const tokens = partsTokens(parts);
  const known = requests.get(key);
  if (!known || tokens > known.tokens) {
    requests.set(key, {
      account: state.account,
      at: known?.at && (!at || known.at < at) ? known.at : at || null,
      tokens,
      cost: requestCost(message.model, parts),
      model: message.model,
    });
    state.version += 1;
  }
  if (!state.keys.has(key)) {
    state.keys.add(key);
    state.version += 1;
  }
}

function recordLedger(state, entry) {
  const { ledger } = state;
  const total = entry.totalCostUSD ?? 0;
  if (total < ledger.lastTotal) {
    for (const [model, cost] of ledger.current) ledger.closed.set(model, (ledger.closed.get(model) ?? 0) + cost);
  }
  ledger.lastTotal = total;
  const models = Object.entries(entry.modelUsage ?? {});
  ledger.current = new Map(models.filter(([, usage]) => Number.isFinite(usage?.costUSD)).map(([model, usage]) => [modelKey(model), usage.costUSD]));
  // The ledger names the context variant (`claude-opus-5[1m]`), which assistant messages never do.
  state.modelId ??= models.map(([model]) => model).find((model) => model.includes('[1m]')) ?? null;
  state.version += 1;
}

function handleLine(state, line) {
  if (!line || !USEFUL_LINE.test(line)) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  if (at && !state.firstAt) state.firstAt = at;
  if (entry.type === 'assistant' && entry.message?.usage && entry.message.id && !String(entry.message.model).startsWith('<')) {
    recordRequest(state, entry, at);
  } else if (entry.type === 'cost-state') {
    recordLedger(state, entry);
  }
  const modelId = entry.attachment?.identity?.modelId;
  if (typeof modelId === 'string') state.modelId = modelId;
  handleBlocks(state, entry);
}

async function readNew(file, state, size) {
  const handle = await fs.open(file, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let position = state.offset;
    let consumed = 0;
    let carry = '';
    while (position < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(CHUNK_BYTES, size - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      const lines = (carry + decoder.write(chunk.subarray(0, bytesRead))).split('\n');
      carry = lines.pop();
      for (const line of lines) {
        handleLine(state, line);
        consumed += Buffer.byteLength(line) + 1;
      }
    }
    // Resume after the last complete line: the one being written will be re-read on the next pass.
    state.offset += consumed;
  } finally {
    await handle.close();
  }
}

/**
 * Updates the tracking of a file: only reads what was appended since the last pass.
 */
export async function trackFile(file, account, sessionId, subagent = false) {
  let state = files.get(file);
  if (!state) {
    state = newState(account, sessionId, subagent);
    files.set(file, state);
    const sessionKey = `${account}:${sessionId}`;
    if (!sessions.has(sessionKey)) sessions.set(sessionKey, new Set());
    sessions.get(sessionKey).add(file);
  }
  if (state.reading) return state.reading;
  state.reading = (async () => {
    try {
      const { size } = await fs.stat(file);
      // Rewritten from the start: read it again (its requests stay known, the keys are the same).
      if (size < state.offset) Object.assign(state, newState(account, sessionId, subagent), { version: state.version + 1 });
      if (size > state.offset) await readNew(file, state, size);
    } catch {
      // File deleted or unreadable: keep what we knew about it.
    } finally {
      state.reading = null;
    }
  })();
  return state.reading;
}

export function tasksOf(file) {
  const state = files.get(file);
  if (!state) return [];
  return [...state.tasks.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, task]) => ({ id, ...task }));
}

/**
 * Size of the context window of a session: 1M when Claude Code runs a `[1m]` model, or when the context is already
 * past 200k tokens; 200k otherwise.
 */
export function contextWindowOf(file, tokens) {
  const modelId = files.get(file)?.modelId;
  if (modelId?.includes('[1m]') || tokens > WINDOW) return WINDOW_1M;
  return WINDOW;
}

/**
 * What a session has done so far, sub-agents included: its most used tools (for the frames on the wall) and the
 * number of file edits (for its chests).
 */
export function sessionWork(account, sessionId) {
  const counts = new Map();
  let edits = 0;
  for (const file of sessions.get(`${account}:${sessionId}`) ?? []) {
    for (const name of files.get(file)?.toolUses.values() ?? []) {
      if (EDIT_TOOLS.has(name)) edits += 1;
      if (!UNFRAMED_TOOLS.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const tools = [...counts].sort((a, b) => b[1] - a[1]).slice(0, FRAMED_TOOLS).map(([name, count]) => ({ name, count }));
  return { tools, edits };
}

const sessionCosts = new Map();

/**
 * Cost of a session in dollars, sub-agents included. Two counts, each missing something: the requests priced one by
 * one (plus the ledger for models without a known price) miss the calls Claude Code does not log, such as
 * compaction; the ledger, added up over every run of the session, misses the run in progress until it writes it.
 * The higher one is closer to the truth. Null before the first request.
 */
export function sessionCost(account, sessionId) {
  const sessionKey = `${account}:${sessionId}`;
  const states = [...(sessions.get(sessionKey) ?? [])].map((file) => files.get(file)).filter(Boolean);
  const version = states.reduce((sum, state) => sum + state.version, 0);
  const cached = sessionCosts.get(sessionKey);
  if (cached?.version === version) return cached.cost;
  const keys = new Set(states.flatMap((state) => [...state.keys]));
  let cost = 0;
  let counted = 0;
  for (const key of keys) {
    const request = requests.get(key);
    if (request?.cost != null) {
      cost += request.cost;
      counted += 1;
    }
  }
  let ledgerTotal = 0;
  for (const state of states) {
    for (const ledger of [state.ledger.closed, state.ledger.current]) {
      for (const [model, value] of ledger) {
        ledgerTotal += value;
        if (isPriced(model)) continue;
        cost += value;
        counted += 1;
      }
    }
  }
  const result = counted || ledgerTotal ? Math.max(cost, ledgerTotal) : null;
  sessionCosts.set(sessionKey, { version, cost: result });
  return result;
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Pass over all recent transcripts of each account (sessions and sub-agents).
 */
export async function rescanAll(accounts, now = Date.now()) {
  for (const account of accounts) {
    const projectsDir = path.join(account.dir, 'projects');
    for (const project of await listDir(projectsDir)) {
      if (!project.isDirectory()) continue;
      const projectDir = path.join(projectsDir, project.name);
      for (const entry of await listDir(projectDir)) {
        const full = path.join(projectDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const stat = await fs.stat(full).catch(() => null);
          if (stat && now - stat.mtimeMs < RECENT_MS) await trackFile(full, account.id, entry.name.slice(0, -6));
        } else if (entry.isDirectory()) {
          const subagentsDir = path.join(full, 'subagents');
          for (const agent of await listDir(subagentsDir)) {
            if (!agent.name.endsWith('.jsonl')) continue;
            const agentFile = path.join(subagentsDir, agent.name);
            const stat = await fs.stat(agentFile).catch(() => null);
            if (stat && now - stat.mtimeMs < RECENT_MS) await trackFile(agentFile, account.id, entry.name, true);
          }
        }
      }
    }
  }
}

/**
 * Usage of the last 7 days per account, at list prices: tokens and cost hour by hour for each day, chats started
 * and agents hired. `unpriced` counts tokens of models without a known price, which are left out of the cost.
 */
export function usageStats(accountList, now = Date.now()) {
  const days = Array.from({ length: STATS_DAYS }, (_, index) => localDay(now - (STATS_DAYS - 1 - index) * 24 * 60 * 60 * 1000));
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const emptyDay = () => ({ hours: Array.from({ length: 24 }, () => ({ tokens: 0, cost: 0 })), sessions: 0, agents: 0, unpriced: 0 });
  const accounts = Object.fromEntries(accountList.map((account) => [account.id, days.map(emptyDay)]));
  for (const request of requests.values()) {
    const index = request.at ? dayIndex.get(localDay(request.at)) : undefined;
    const target = accounts[request.account]?.[index];
    if (!target) continue;
    const hour = target.hours[new Date(request.at).getHours()];
    hour.tokens += request.tokens;
    if (request.cost == null) target.unpriced += request.tokens;
    else hour.cost += request.cost;
  }
  for (const state of files.values()) {
    const index = state.firstAt ? dayIndex.get(localDay(state.firstAt)) : undefined;
    const target = accounts[state.account]?.[index];
    if (!target) continue;
    if (state.subagent) target.agents += 1;
    else target.sessions += 1;
  }
  return {
    days,
    accounts: Object.fromEntries(Object.entries(accounts).map(([id, list]) => [id, list.map((day) => ({
      ...day,
      tokens: day.hours.reduce((sum, hour) => sum + hour.tokens, 0),
      cost: day.hours.reduce((sum, hour) => sum + hour.cost, 0),
    }))])),
  };
}
