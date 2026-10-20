import fs from 'node:fs/promises';

// History of a session: enough of the end of the transcript for its latest exchanges and tools.
const HISTORY_TAIL_BYTES = 2 * 1024 * 1024;
const HISTORY_LIMIT = 40;

const cache = new Map();

async function readTail(file, size, bytes) {
  const handle = await fs.open(file, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    // The first line is cut off whenever we do not start from the beginning of the file.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}

function parseLines(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Line still being written.
    }
  }
  return entries;
}

function truncate(text, max) {
  if (!text) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function basename(file) {
  return file ? String(file).split('/').filter(Boolean).at(-1) : '';
}

function describeTool({ name, input = {} }) {
  switch (name) {
    case 'Bash':
      return input.description || input.command;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return basename(input.file_path || input.notebook_path);
    case 'Grep':
    case 'Glob':
      return input.pattern;
    case 'WebSearch':
      return input.query;
    case 'WebFetch':
      try {
        return new URL(input.url).host;
      } catch {
        return input.url;
      }
    case 'Agent':
    case 'Task':
      return input.description;
    case 'Skill':
      return input.skill;
    case 'AskUserQuestion':
      return input.questions?.[0]?.question;
    case 'TaskCreate':
      return input.subject;
    // TodoWrite and TaskUpdate are worded by the page, in its language (see taskFields).
    default:
      return name.startsWith('mcp__') ? name.split('__').slice(2).join(' ') : '';
  }
}

/**
 * Task touched by a TaskUpdate call: its number and new status, for the page to put into words.
 */
function taskFields(block) {
  if (block.name !== 'TaskUpdate' || !block.input?.taskId) return {};
  return { taskId: String(block.input.taskId), taskStatus: typeof block.input.status === 'string' ? block.input.status : null };
}

function isRealPrompt(text) {
  return typeof text === 'string' && text.trim() && !text.trimStart().startsWith('<');
}

/**
 * Summarizes the end of a transcript: title, last message on each side, tool waiting for its result.
 */
function summarize(entries) {
  const pending = new Map();
  const summary = {
    title: null,
    customTitle: null,
    lastPrompt: null,
    lastText: null,
    lastKind: null,
    contextTokens: null,
    model: null,
    handback: false,
    continuedIn: null,
    costUSD: null,
    lastAt: null,
  };
  for (const entry of entries) {
    const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (at > (summary.lastAt ?? 0)) summary.lastAt = at;
    if (entry.type === 'continued-in') summary.continuedIn = entry.continuedInSessionId ?? null;
    if (entry.type === 'cost-state' && typeof entry.totalCostUSD === 'number') summary.costUSD = entry.totalCostUSD;
    if (entry.type === 'ai-title' && entry.aiTitle) summary.title = entry.aiTitle;
    if (entry.type === 'custom-title' && entry.customTitle) summary.customTitle = entry.customTitle;
    if (entry.type === 'last-prompt' && isRealPrompt(entry.lastPrompt)) summary.lastPrompt = entry.lastPrompt;
    const content = entry.message?.content;
    if (entry.type === 'assistant' && Array.isArray(content)) {
      const { usage, model } = entry.message;
      if (usage) {
        summary.contextTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0);
      }
      if (model && !model.startsWith('<')) summary.model = model;
      for (const block of content) {
        if (block.type === 'tool_use') {
          pending.set(block.id, block);
          summary.lastKind = 'tool_use';
          if (block.name === 'SubagentHandback') summary.handback = true;
        } else if (block.type === 'text' && block.text?.trim()) {
          summary.lastText = block.text;
          summary.lastKind = 'text';
        } else if (block.type === 'thinking') {
          summary.lastKind = 'thinking';
        }
      }
    } else if (entry.type === 'user' && !entry.isMeta) {
      if (isRealPrompt(content)) {
        summary.lastKind = 'prompt';
        summary.lastPrompt = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            pending.delete(block.tool_use_id);
            summary.lastKind = 'tool_result';
          } else if (block.type === 'text' && isRealPrompt(block.text)) {
            summary.lastKind = 'prompt';
            summary.lastPrompt = block.text;
          }
        }
      }
    }
  }
  const open = [...pending.values()].at(-1);
  summary.tool = open ? { name: open.name, label: truncate(describeTool(open), 90), ...taskFields(open) } : null;
  summary.lastPrompt = truncate(summary.lastPrompt, 220);
  summary.lastText = truncate(summary.lastText, 220);
  return summary;
}

/**
 * Summary of a transcript, recomputed only when the file has changed.
 */
export async function summarizeTranscript(file, stat, tailBytes) {
  const cached = cache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.summary;
  const summary = summarize(parseLines(await readTail(file, stat.size, tailBytes)));
  cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, summary });
  return summary;
}

/**
 * Latest exchanges of a session: your messages, Claude's replies and its tools, from oldest to newest.
 */
export async function sessionHistory(file) {
  const { size } = await fs.stat(file);
  const events = [];
  for (const entry of parseLines(await readTail(file, size, HISTORY_TAIL_BYTES))) {
    const at = entry.timestamp ? Date.parse(entry.timestamp) : null;
    const content = entry.message?.content;
    if (entry.type === 'user' && !entry.isMeta) {
      const prompts = isRealPrompt(content) ? [content]
        : Array.isArray(content) ? content.filter((block) => block.type === 'text' && isRealPrompt(block.text)).map((block) => block.text) : [];
      for (const text of prompts) events.push({ at, kind: 'prompt', text: truncate(text, 300) });
    } else if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) events.push({ at, kind: 'text', text: truncate(block.text, 300) });
        else if (block.type === 'tool_use') events.push({ at, kind: 'tool', tool: block.name, text: truncate(describeTool(block), 120), ...taskFields(block) });
      }
    }
  }
  return events.slice(-HISTORY_LIMIT);
}
