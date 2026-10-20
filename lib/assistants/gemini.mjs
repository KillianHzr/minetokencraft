import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestCost } from '../pricing.mjs';
import { recordOutsideRequest, recordOutsideSession } from '../tracker.mjs';

// Gemini CLI (Google): one file per session in ~/.gemini/tmp/<project>/chats, JSON lines (session-*.jsonl: a record
// per message, `message_update` records rewriting a message's tokens) or, in older versions, one JSON document with
// a `messages` array. Like Codex, it keeps no registry of running sessions: a session is live while its file moves.
// A session whose last message is yours is working; after Gemini's answer, it is done.

const RECENT_MS = 8 * 24 * 60 * 60 * 1000;
const LISTED_MS = 12 * 60 * 60 * 1000;
const TOOLS = {
  run_shell_command: 'Bash', read_file: 'Read', read_many_files: 'Read', write_file: 'Write', replace: 'Edit',
  glob: 'Glob', search_file_content: 'Grep', list_directory: 'LS', web_fetch: 'WebFetch', google_web_search: 'WebSearch',
  save_memory: 'TodoWrite', write_todos: 'TodoWrite',
};
const EDITS = new Set(['write_file', 'replace']);
const FRAMED_TOOLS = 2;

const files = new Map();

function toolName(name) {
  return TOOLS[name] ?? name ?? 'Bash';
}

function text(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join(' ');
  return '';
}

/**
 * Reads a session file whole (they stay small) into its messages, the last version of each.
 */
function parse(raw, jsonl) {
  const messages = new Map();
  let meta = {};
  const absorb = (record) => {
    if (record.type === 'session_metadata') meta = record;
    else if (record.type === 'message_update' && messages.has(record.id)) Object.assign(messages.get(record.id), record, { type: messages.get(record.id).type });
    else if (record.id && (record.type === 'user' || record.type === 'gemini')) messages.set(record.id, { ...record });
  };
  if (jsonl) {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        absorb(JSON.parse(line));
      } catch {
        // Line being written.
      }
    }
  } else {
    try {
      const document = JSON.parse(raw);
      meta = document;
      for (const message of document.messages ?? []) absorb(message);
    } catch {
      return null;
    }
  }
  return { meta, messages: [...messages.values()] };
}

async function track(file, account, mtimeMs) {
  const known = files.get(file);
  if (known?.mtimeMs === mtimeMs) return;
  const parsed = parse(await fs.readFile(file, 'utf8').catch(() => ''), file.endsWith('.jsonl'));
  if (!parsed) return;
  const { meta, messages } = parsed;
  const stamp = (message) => (message.timestamp ? Date.parse(message.timestamp) : null);
  const firstAt = meta.startTime ? Date.parse(meta.startTime) : stamp(messages[0] ?? {});
  const state = { mtimeMs, sessionId: meta.sessionId ?? path.basename(file).replace(/\.jsonl?$/, ''), firstAt, messages, costUSD: 0, tools: new Map(), edits: 0 };
  recordOutsideSession(`gemini:${file}`, { account, firstAt, subagent: false });
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      state.tools.set(call.name, (state.tools.get(call.name) ?? 0) + 1);
      if (EDITS.has(call.name)) state.edits += 1;
    }
    const tokens = message.type === 'gemini' && message.tokens;
    if (!tokens) continue;
    const cached = tokens.cached ?? 0;
    const parts = {
      input: Math.max(0, (tokens.input ?? 0) - cached) + (tokens.tool ?? 0),
      output: (tokens.output ?? 0) + (tokens.thoughts ?? 0),
      cacheRead: cached,
      write5m: 0,
      write1h: 0,
      webSearches: 0,
    };
    const cost = requestCost(message.model, parts);
    state.costUSD += cost ?? 0;
    state.model = message.model ?? state.model;
    state.context = { tokens: tokens.input ?? null };
    recordOutsideRequest(`gemini:${file}:${message.id}`, { account, at: stamp(message) ?? firstAt, tokens: tokens.total ?? 0, cost, model: message.model });
  }
  files.set(file, state);
}

async function chatFiles(root, now) {
  const found = [];
  for (const project of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    const chats = path.join(root, project.name, 'chats');
    for (const name of await fs.readdir(chats).catch(() => [])) {
      if (!/\.jsonl?$/.test(name)) continue;
      const file = path.join(chats, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat && now - stat.mtimeMs < RECENT_MS) found.push([file, stat.mtimeMs, project.name]);
    }
  }
  return found;
}

export const gemini = {
  tool: 'gemini',
  label: 'Gemini',

  /**
   * Gemini CLI's folder (~/.gemini, its `tmp` folder holds the sessions), when it was used in the last days.
   */
  async find(now = Date.now()) {
    const dir = path.join(os.homedir(), '.gemini');
    return (await chatFiles(path.join(dir, 'tmp'), now)).length ? dir : null;
  },

  async scan(account, now = Date.now()) {
    for (const [file, mtimeMs, project] of await chatFiles(path.join(account.dir, 'tmp'), now)) {
      await track(file, account.id, mtimeMs);
      const state = files.get(file);
      if (state) state.project = project;
    }
  },

  // Gemini CLI writes no quota in its sessions.
  usage() {
    return null;
  },

  players(account, now, { timing }) {
    return [...files.entries()].filter(([, state]) => now - state.mtimeMs < LISTED_MS).map(([file, state]) => {
      const silentFor = now - state.mtimeMs;
      const last = state.messages.at(-1);
      const lastUser = state.messages.findLast((message) => message.type === 'user');
      const lastAnswer = state.messages.findLast((message) => message.type === 'gemini' && text(message.content).trim());
      const pendingCall = last?.type === 'gemini' && (last.toolCalls ?? []).find((call) => !call.result && call.status !== 'success');
      const status = (last?.type === 'user' || pendingCall) && silentFor < timing.busyStale ? 'working'
        : silentFor < timing.dormantAfter ? 'done' : 'sleeping';
      const tools = [...state.tools].sort((a, b) => b[1] - a[1]).slice(0, FRAMED_TOOLS).map(([name, count]) => ({ name: toolName(name), count }));
      const first = state.messages.find((message) => message.type === 'user');
      return {
        id: `${account.id}:${state.sessionId}`,
        file,
        account: account.id,
        accountLabel: account.label,
        accountSlot: account.slot,
        pid: null,
        sessionId: state.sessionId,
        kind: 'interactive',
        name: text(first?.content).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Gemini',
        shortName: null,
        cwd: null,
        project: state.project?.slice(0, 8) ?? 'gemini',
        status,
        waitingFor: null,
        waitingSince: null,
        stuck: false,
        tasks: null,
        work: { tools, edits: state.edits },
        git: null,
        tool: status === 'working' && pendingCall ? { name: toolName(pendingCall.name), label: '' } : null,
        thinking: status === 'working' && !pendingCall,
        lastPrompt: text(lastUser?.content).slice(0, 220) || null,
        lastText: text(lastAnswer?.content).slice(0, 220) || null,
        context: { tokens: state.context?.tokens ?? null, size: null, pct: null },
        costUSD: state.costUSD || null,
        model: state.model ?? null,
        startedAt: state.firstAt,
        lastActivityAt: state.mtimeMs,
        villagers: [],
      };
    });
  },

  async history(file, limit = 40) {
    const state = files.get(file);
    if (!state) return [];
    const events = [];
    for (const message of state.messages) {
      const at = message.timestamp ? Date.parse(message.timestamp) : null;
      const said = text(message.content).trim();
      if (said) events.push({ at, kind: message.type === 'user' ? 'prompt' : 'text', text: said.slice(0, 300) });
      for (const call of message.toolCalls ?? []) events.push({ at, kind: 'tool', tool: toolName(call.name), text: JSON.stringify(call.args ?? {}).slice(0, 120) });
    }
    return events.slice(-limit);
  },
};
