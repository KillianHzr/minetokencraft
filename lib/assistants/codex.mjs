import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { partsTokens, requestCost } from '../pricing.mjs';
import { readAppended, recordOutsideRequest, recordOutsideSession } from '../tracker.mjs';

// Codex CLI (OpenAI): its sessions are "rollouts", one JSON lines file each in ~/.codex/sessions/YYYY/MM/DD (or under
// CODEX_HOME). Codex keeps no registry of running sessions, so a session counts as live while its rollout moves:
// working inside a turn (task_started without task_complete), waiting when it asked you something, done after.
// Each token_count event carries the turn's tokens, the context window and the account's rate limits (5 hours and
// week), which become the quotas of the Codex wing. Sub-agent rollouts name their parent: they are its villagers.

const RECENT_MS = 8 * 24 * 60 * 60 * 1000;
// Sessions older than this are no longer listed at all, even as idle.
const LISTED_MS = 12 * 60 * 60 * 1000;
// Only these lines are parsed; the rest (reasoning, tool outputs, file contents) is skipped.
const USEFUL_LINE = /"type":"(session_meta|turn_context|token_count|task_started|task_complete|turn_aborted|user_message|agent_message|function_call|custom_tool_call|function_call_output|custom_tool_call_output)"/;
// Codex tool names, in the names the village knows (furniture, held item).
const TOOLS = {
  exec: 'Bash', shell: 'Bash', local_shell: 'Bash', exec_command: 'Bash', js: 'Bash', wait: 'Bash', sleep: 'Bash',
  apply_patch: 'Edit', view_image: 'Read', read_file: 'Read', web_search: 'WebSearch',
  update_plan: 'TodoWrite', spawn_agent: 'Agent', request_user_input: 'AskUserQuestion', request_user_input_async: 'AskUserQuestion',
};
const ASKING = new Set(['request_user_input', 'request_user_input_async']);
const EDITS = new Set(['apply_patch']);
const FRAMED_TOOLS = 2;

const files = new Map();

function toolName(name) {
  return TOOLS[name] ?? (name?.startsWith('mcp__') ? name : name ?? 'Bash');
}

function newState() {
  return {
    offset: 0,
    sessionId: null,
    parentId: null,
    cwd: null,
    model: null,
    source: null,
    firstAt: null,
    lastAt: null,
    title: null,
    lastPrompt: null,
    lastText: null,
    turn: null,
    pending: new Map(),
    plan: null,
    costUSD: 0,
    context: null,
    limits: null,
    tools: new Map(),
    edits: 0,
    turns: 0,
    // Token counts read so far: each one's number keys it in the usage stats.
    counted: 0,
  };
}

function text(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => part?.text ?? '').join(' ');
  return '';
}

function parseArguments(raw) {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function handleLine(state, account, file, line) {
  if (!line || !USEFUL_LINE.test(line)) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  const at = entry.timestamp ? Date.parse(entry.timestamp) : null;
  if (at) {
    state.firstAt ??= at;
    state.lastAt = Math.max(state.lastAt ?? 0, at);
  }
  const payload = entry.payload ?? {};
  if (entry.type === 'session_meta') {
    state.sessionId = payload.id ?? payload.session_id ?? state.sessionId;
    state.parentId = payload.parent_thread_id ?? null;
    state.cwd = payload.cwd ?? state.cwd;
    state.source = payload.source ?? null;
    // A forked or resumed rollout copies its parent's history first: only what comes after its own start counts.
    state.since = payload.timestamp ? Date.parse(payload.timestamp) : at;
    recordOutsideSession(`codex:${file}`, { account, firstAt: state.since, subagent: Boolean(state.parentId) });
  } else if (entry.type === 'turn_context') {
    state.model = payload.model ?? state.model;
    state.cwd = payload.cwd ?? state.cwd;
  } else if (entry.type === 'event_msg') {
    handleEvent(state, account, file, payload, at);
  } else if (entry.type === 'response_item') {
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const args = parseArguments(payload.arguments ?? payload.input);
      state.pending.set(payload.call_id ?? payload.id, { name: payload.name, args, at });
      state.tools.set(payload.name, (state.tools.get(payload.name) ?? 0) + 1);
      if (EDITS.has(payload.name)) state.edits += 1;
      if (payload.name === 'update_plan' && Array.isArray(args.plan)) state.plan = args.plan;
    } else {
      state.pending.delete(payload.call_id ?? payload.id);
    }
  }
}

function handleEvent(state, account, file, payload, at) {
  switch (payload.type) {
    case 'task_started':
      state.turn = 'started';
      state.turns += 1;
      break;
    case 'task_complete':
    case 'turn_aborted':
      state.turn = 'complete';
      state.pending.clear();
      break;
    case 'user_message': {
      const message = text(payload.message).trim();
      if (message) {
        state.title ??= message;
        state.lastPrompt = message;
      }
      break;
    }
    case 'agent_message':
      state.lastText = text(payload.message).trim() || state.lastText;
      break;
    case 'token_count': {
      const info = payload.info;
      const usage = info?.last_token_usage;
      if (usage) {
        const cached = usage.cached_input_tokens ?? 0;
        const parts = {
          input: Math.max(0, (usage.input_tokens ?? 0) - cached),
          output: usage.output_tokens ?? 0,
          cacheRead: cached,
          write5m: usage.cache_write_input_tokens ?? 0,
          write1h: 0,
          webSearches: 0,
        };
        state.context = { tokens: usage.input_tokens ?? null, size: info.model_context_window ?? null };
        if (!state.since || !at || at >= state.since) {
          const cost = requestCost(state.model, parts);
          state.costUSD += cost ?? 0;
          state.counted += 1;
          recordOutsideRequest(`codex:${file}:${state.counted}`, { account, at, tokens: usage.total_tokens ?? partsTokens(parts), cost, model: state.model });
        }
      }
      if (payload.rate_limits?.primary || payload.rate_limits?.secondary) state.limits = { ...payload.rate_limits, at };
      break;
    }
    default:
  }
}

async function track(file, account) {
  let state = files.get(file);
  if (!state) {
    state = newState();
    files.set(file, state);
  }
  if (state.reading) return state.reading;
  state.reading = (async () => {
    try {
      const { size, mtimeMs } = await fs.stat(file);
      state.mtimeMs = mtimeMs;
      if (size < state.offset) Object.assign(state, newState());
      if (size > state.offset) await readAppended(file, state, size, (line) => handleLine(state, account, file, line));
    } catch {
      // Deleted or unreadable: keep what we knew.
    } finally {
      state.reading = null;
    }
  })();
  return state.reading;
}

async function walk(dir, now, found = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, now, found);
    else if (/^rollout-.*\.jsonl$/.test(entry.name)) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat && now - stat.mtimeMs < RECENT_MS) found.push(full);
    }
  }
  return found;
}

export const codex = {
  tool: 'codex',
  label: 'Codex',

  /**
   * Codex's folder (CODEX_HOME, else ~/.codex), when it was used in the last days: no empty wing for an assistant
   * installed once and forgotten.
   */
  async find(now = Date.now()) {
    const dir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    return (await walk(path.join(dir, 'sessions'), now)).length ? dir : null;
  },

  /**
   * Reads what changed in the rollouts of the last days.
   */
  async scan(account, now = Date.now()) {
    for (const file of await walk(path.join(account.dir, 'sessions'), now)) await track(file, account.id);
  },

  /**
   * The quotas of the latest token count, as the village shows them: the 5-hour window and the week.
   */
  usage(now = Date.now()) {
    const latest = [...files.values()].filter((state) => state.limits).sort((a, b) => (b.limits.at ?? 0) - (a.limits.at ?? 0))[0]?.limits;
    if (!latest) return null;
    // A window that reset since the last count is empty again.
    const quota = (limit) => {
      if (!limit || typeof limit.used_percent !== 'number') return null;
      const resetsAt = limit.resets_at ? limit.resets_at * 1000 : null;
      return resetsAt && resetsAt <= now ? { usedPct: 0, resetsAt: null } : { usedPct: limit.used_percent, resetsAt };
    };
    const windows = [latest.primary, latest.secondary].filter(Boolean);
    const plan = latest.plan_type ? latest.plan_type.charAt(0).toUpperCase() + latest.plan_type.slice(1) : null;
    return {
      plan,
      usage: {
        fiveHour: quota(windows.find((limit) => limit.window_minutes <= 300) ?? latest.primary),
        sevenDay: quota(windows.find((limit) => limit.window_minutes >= 10080) ?? latest.secondary),
      },
    };
  },

  /**
   * The sessions to show, as players: those whose rollout moved in the last hours, sub-agents as villagers.
   */
  players(account, now, { projectLabel, gitStatus, timing }) {
    const states = [...files.entries()].filter(([, state]) => state.sessionId && state.mtimeMs && now - state.mtimeMs < LISTED_MS);
    const children = states.filter(([, state]) => state.parentId);
    return states.filter(([, state]) => !state.parentId).map(([file, state]) => {
      const silentFor = now - state.mtimeMs;
      const last = [...state.pending.values()].at(-1);
      const asking = last && ASKING.has(last.name);
      const status = asking && silentFor < timing.busyStale ? 'waiting'
        : state.turn === 'started' && silentFor < timing.busyStale ? 'working'
          : silentFor < timing.dormantAfter ? 'done' : 'sleeping';
      const tools = [...state.tools].sort((a, b) => b[1] - a[1]).slice(0, FRAMED_TOOLS).map(([name, count]) => ({ name: toolName(name), count }));
      const plan = state.plan ?? [];
      const current = plan.find((step) => step.status === 'in_progress');
      const context = state.context?.tokens
        ? { ...state.context, pct: state.context.size ? Math.round((state.context.tokens / state.context.size) * 100) : null }
        : { tokens: null, size: null, pct: null };
      const villagers = children.filter(([, child]) => child.parentId === state.sessionId).map(([, child]) => {
        const childLast = [...child.pending.values()].at(-1);
        const working = child.turn === 'started' && now - child.mtimeMs < timing.villagerStale;
        return {
          id: child.sessionId,
          type: 'codex',
          description: (child.title ?? '').slice(0, 120),
          status: working ? 'working' : 'done',
          tool: working && childLast ? { name: toolName(childLast.name), label: '' } : null,
          startedAt: child.firstAt,
          endedAt: working ? null : child.mtimeMs,
        };
      }).filter((villager) => villager.status === 'working' || now - villager.endedAt < timing.villagerLinger);
      return {
        id: `${account.id}:${state.sessionId}`,
        file,
        account: account.id,
        accountLabel: account.label,
        accountSlot: account.slot,
        pid: null,
        sessionId: state.sessionId,
        kind: state.source === 'exec' ? 'bg' : 'interactive',
        name: (state.title ?? '').replace(/\s+/g, ' ').slice(0, 80) || projectLabel(state.cwd),
        shortName: null,
        cwd: state.cwd,
        project: projectLabel(state.cwd),
        status,
        waitingFor: status === 'waiting' ? 'input needed' : null,
        waitingSince: status === 'waiting' ? last.at : null,
        stuck: false,
        tasks: plan.length ? {
          done: plan.filter((step) => step.status === 'completed').length,
          total: plan.length,
          current: current?.step ?? null,
          items: plan.map((step) => ({ subject: step.step, status: step.status })),
        } : null,
        work: { tools, edits: state.edits },
        git: state.cwd ? gitStatus(state.cwd) : null,
        tool: status === 'working' && last ? { name: toolName(last.name), label: '' } : null,
        thinking: status === 'working' && !last,
        lastPrompt: state.lastPrompt?.slice(0, 220) ?? null,
        lastText: state.lastText?.slice(0, 220) ?? null,
        context,
        costUSD: state.costUSD || null,
        model: state.model,
        startedAt: state.firstAt,
        lastActivityAt: state.mtimeMs,
        villagers,
      };
    });
  },

  /**
   * History of a session: your messages, Codex's answers and its tools, oldest first.
   */
  async history(file, limit = 40) {
    const events = [];
    const state = { offset: 0 };
    const { size } = await fs.stat(file);
    await readAppended(file, state, size, (line) => {
      if (!/"type":"(user_message|agent_message|function_call|custom_tool_call)"/.test(line)) return;
      try {
        const entry = JSON.parse(line);
        const payload = entry.payload ?? {};
        const at = entry.timestamp ? Date.parse(entry.timestamp) : null;
        if (payload.type === 'user_message') events.push({ at, kind: 'prompt', text: text(payload.message).slice(0, 300) });
        else if (payload.type === 'agent_message') events.push({ at, kind: 'text', text: text(payload.message).slice(0, 300) });
        else events.push({ at, kind: 'tool', tool: toolName(payload.name), text: describe(payload) });
        if (events.length > limit * 4) events.splice(0, events.length - limit);
      } catch {
        // Line being written.
      }
    });
    return events.slice(-limit);
  },
};

function describe(payload) {
  const args = parseArguments(payload.arguments ?? payload.input);
  const command = Array.isArray(args.command) ? args.command.join(' ') : args.command ?? args.cmd;
  if (command) return String(command).slice(0, 120);
  if (typeof payload.input === 'string') return payload.input.split('\n')[0].slice(0, 120);
  return '';
}
