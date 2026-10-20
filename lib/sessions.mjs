import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BUSY_STALE_MS,
  DORMANT_AFTER_MS,
  SESSION_TAIL_BYTES,
  STUCK_AFTER_MS,
  VILLAGER_LINGER_MS,
  VILLAGER_STALE_MS,
  VILLAGER_TAIL_BYTES,
} from '../config.mjs';
import { readStatuslines } from './statusline.mjs';
import { summarizeTranscript } from './transcript.mjs';
import { contextWindowOf, rescanAll, sessionCost, sessionWork, tasksOf, trackFile, usageStats } from './tracker.mjs';
import { gitStatus } from './git.mjs';
import { forecastFor, recordUsage } from './forecast.mjs';
import { weatherNow } from './weather.mjs';
import { listAccounts } from './accounts.mjs';
import { limitsFor } from './limits.mjs';

const run = promisify(execFile);
const home = os.homedir();
// Directories too generic to name a project on their own: we keep their parent as well.
const GENERIC_DIRS = new Set(['staging', 'main', 'master', 'develop', 'current', 'dev', 'src', 'app', 'www', 'html']);
// A sub-agent that just wrote text may still go on to a tool: we wait before calling it done.
const VILLAGER_SETTLE_MS = 15 * 1000;
const SHOWN_KINDS = new Set(['interactive', 'bg']);
// Usage stats: recomputed every 30 s, with everyone's transcripts re-read every minute.
const STATS_REFRESH_MS = 30 * 1000;
const RESCAN_MS = 60 * 1000;
const TASKS_LISTED = 12;

const transcriptDirs = new Map();
// Last server-side snapshot: enough to find a player's transcript and pid (history, terminal).
const known = new Map();
let stats = null;
let statsAt = 0;
let rescanAt = 0;

export function knownPlayer(id) {
  return known.get(id) ?? null;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

/**
 * Processes that can be a Claude Code session. The registry keeps the files of sessions that crashed, and their pid
 * may have gone to another program since: only a process named like Claude counts. On Windows, an npm install runs
 * Claude Code as node.exe, so node counts too.
 */
async function claudePids() {
  const pids = new Set();
  if (process.platform === 'win32') {
    const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) {
      const [name, pid] = line.split('","').map((field) => field.replace(/^"|"$/g, ''));
      if (/claude|node/i.test(name ?? '') && Number(pid)) pids.add(Number(pid));
    }
    return pids;
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,comm=']);
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match && match[2].includes('claude')) pids.add(Number(match[1]));
  }
  return pids;
}

function projectLabel(cwd) {
  if (!cwd || cwd === home) return '~';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1);
  return GENERIC_DIRS.has(last) && parts.length > 1 ? `${parts.at(-2)}/${last}` : last;
}

/**
 * Directory of a session's transcript: the one Claude Code derives from the cwd, otherwise we search every project.
 */
async function findProjectDir(account, cwd, sessionId) {
  const key = `${account.id}:${sessionId}`;
  if (transcriptDirs.has(key)) return transcriptDirs.get(key);
  const projectsDir = path.join(account.dir, 'projects');
  const candidates = [cwd.replace(/[^a-zA-Z0-9]/g, '-')];
  try {
    candidates.push(...await fs.readdir(projectsDir));
  } catch {
    return null;
  }
  for (const name of candidates) {
    const dir = path.join(projectsDir, name);
    if (await statOrNull(path.join(dir, `${sessionId}.jsonl`))) {
      transcriptDirs.set(key, dir);
      return dir;
    }
  }
  return null;
}

async function collectVillagers(account, sessionId, subagentsDir, now) {
  let names;
  try {
    names = await fs.readdir(subagentsDir);
  } catch {
    return [];
  }
  const villagers = [];
  for (const name of names) {
    const match = name.match(/^agent-(.+)\.jsonl$/);
    if (!match) continue;
    const file = path.join(subagentsDir, name);
    const stat = await statOrNull(file);
    const silentFor = stat ? now - stat.mtimeMs : Infinity;
    if (silentFor > Math.max(VILLAGER_LINGER_MS, VILLAGER_STALE_MS)) continue;
    const summary = await summarizeTranscript(file, stat, VILLAGER_TAIL_BYTES);
    await trackFile(file, account.id, sessionId, true);
    const done = summary.handback || silentFor > VILLAGER_STALE_MS
      || (summary.lastKind === 'text' && silentFor > VILLAGER_SETTLE_MS);
    if (done && silentFor > VILLAGER_LINGER_MS) continue;
    const meta = await readJson(path.join(subagentsDir, `agent-${match[1]}.meta.json`)) ?? {};
    villagers.push({
      id: match[1],
      file,
      type: meta.agentType ?? 'general-purpose',
      description: meta.description ?? '',
      status: done ? 'done' : 'working',
      tool: done ? null : summary.tool,
      startedAt: stat.birthtimeMs,
      endedAt: done ? stat.mtimeMs : null,
    });
  }
  return villagers.sort((a, b) => a.startedAt - b.startedAt);
}

function playerStatus(registry, lastActivityAt, villagers, now) {
  if (registry.status === 'waiting') return 'waiting';
  const fresh = now - lastActivityAt < BUSY_STALE_MS;
  if ((registry.status === 'busy' || registry.status === 'shell') && fresh) return 'working';
  if (villagers.some((villager) => villager.status === 'working')) return 'working';
  return now - lastActivityAt < DORMANT_AFTER_MS ? 'done' : 'sleeping';
}

/**
 * Context fill: the prompt of the last request (input and cache) over the model's window. The status line, when
 * installed, gives both exactly; otherwise the transcript does.
 */
function contextOf(statusline, summary, file) {
  const tokens = statusline?.context.tokens || summary.contextTokens || null;
  if (!tokens) return { tokens: null, size: statusline?.context.size ?? null, pct: statusline?.context.pct ?? null };
  const size = statusline?.context.size ?? contextWindowOf(file, tokens);
  return { tokens, size, pct: statusline?.context.pct ?? Math.round((tokens / size) * 100) };
}

/**
 * Progress of the session's task list (TaskCreate / TaskUpdate), if it has one.
 */
function taskProgress(file) {
  const tasks = tasksOf(file);
  if (!tasks.length) return null;
  const current = tasks.find((task) => task.status === 'in_progress');
  return {
    done: tasks.filter((task) => task.status === 'completed').length,
    total: tasks.length,
    current: current ? current.activeForm || current.subject : null,
    items: tasks.slice(0, TASKS_LISTED).map(({ subject, status }) => ({ subject, status })),
  };
}

async function buildPlayer(account, registry, now, statuslines) {
  const projectDir = await findProjectDir(account, registry.cwd, registry.sessionId);
  const transcriptFile = projectDir && path.join(projectDir, `${registry.sessionId}.jsonl`);
  const stat = transcriptFile && await statOrNull(transcriptFile);
  const summary = stat ? await summarizeTranscript(transcriptFile, stat, SESSION_TAIL_BYTES) : {};
  if (stat) await trackFile(transcriptFile, account.id, registry.sessionId);
  // Conversation resumed in another session (background task): that is the one we show.
  if (summary.continuedIn) return null;
  const villagers = projectDir
    ? await collectVillagers(account, registry.sessionId, path.join(projectDir, registry.sessionId, 'subagents'), now)
    : [];
  const lastActivityAt = Math.max(
    registry.statusUpdatedAt ?? 0,
    summary.lastAt ?? stat?.mtimeMs ?? 0,
    registry.startedAt ?? 0,
  );
  const status = playerStatus(registry, lastActivityAt, villagers, now);
  const named = registry.nameSource && registry.nameSource !== 'derived';
  const statusline = statuslines.get(`${account.id}:${registry.sessionId}`);
  const id = `${account.id}:${registry.pid}`;
  known.set(id, { file: transcriptFile, pid: registry.pid, cwd: registry.cwd, agents: new Map(villagers.map((villager) => [villager.id, villager.file])) });
  return {
    id,
    account: account.id,
    accountLabel: account.label,
    accountSlot: account.slot,
    pid: registry.pid,
    sessionId: registry.sessionId,
    kind: registry.kind ?? 'interactive',
    name: (named && registry.name) || summary.customTitle || summary.title || registry.name || projectLabel(registry.cwd),
    shortName: registry.name,
    cwd: registry.cwd,
    project: projectLabel(registry.cwd),
    status,
    waitingFor: status === 'waiting' ? registry.waitingFor ?? null : null,
    waitingSince: status === 'waiting' ? registry.statusUpdatedAt ?? null : null,
    // Working but nothing written for a while: a very long command, or a stuck session.
    stuck: status === 'working' && registry.status === 'busy' && now - lastActivityAt > STUCK_AFTER_MS,
    tasks: transcriptFile ? taskProgress(transcriptFile) : null,
    // Most used tools and file edits, for the room that fills up with the session.
    work: sessionWork(account.id, registry.sessionId),
    git: gitStatus(registry.cwd),
    tool: status === 'working' && registry.status !== 'idle' ? summary.tool ?? null : null,
    thinking: status === 'working' && registry.status === 'busy' && !summary.tool,
    lastPrompt: summary.lastPrompt ?? null,
    lastText: summary.lastText ?? null,
    context: contextOf(statusline, summary, transcriptFile),
    // Priced from the transcripts, sub-agents included. The status line also counts calls the transcript does not
    // show, but starts again from $0 when a session is resumed: the higher of the two wins.
    costUSD: Math.max(sessionCost(account.id, registry.sessionId) ?? 0, statusline?.costUSD ?? 0) || null,
    model: statusline?.model ?? summary.model ?? null,
    startedAt: registry.startedAt ?? null,
    lastActivityAt,
    // The transcript paths stay on the server: the page asks for a history by id.
    villagers: villagers.map(({ file, ...villager }) => villager),
  };
}

/**
 * Snapshot of all the live Claude sessions of the configured accounts. `alive` replaces the process list, for tests.
 */
export async function collectState({ alive: knownAlive } = {}) {
  const now = Date.now();
  const accountList = await listAccounts();
  const [alive, { sessions: statuslines, usage }] = await Promise.all([knownAlive ?? claudePids(), readStatuslines(now, accountList)]);
  const players = [];
  for (const account of accountList) {
    const sessionsDir = path.join(account.dir, 'sessions');
    let files;
    try {
      files = (await fs.readdir(sessionsDir)).filter((file) => /^\d+\.json$/.test(file));
    } catch {
      continue;
    }
    for (const file of files) {
      const registry = await readJson(path.join(sessionsDir, file));
      if (!registry?.sessionId || !registry.cwd || registry.spare || !alive.has(registry.pid)) continue;
      if (!SHOWN_KINDS.has(registry.kind ?? 'interactive')) continue;
      const player = await buildPlayer(account, registry, now, statuslines);
      if (player) players.push(player);
    }
  }
  players.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  // Quotas: Anthropic's own when they are recent, otherwise the status line's.
  for (const account of accountList) {
    const official = limitsFor(account.id)?.usage;
    if (official) usage[account.id] = official;
  }
  await recordUsage(usage, now);
  const accounts = accountList.map(({ id, label, slot }) => ({
    id, label, slot, plan: limitsFor(id)?.plan ?? null, usage: usage[id], forecast: forecastFor(id, usage[id], now),
  }));
  if (now - rescanAt > RESCAN_MS) {
    rescanAt = now;
    rescanAll(accountList, now).catch((error) => console.error('cannot read transcripts:', error));
  }
  if (now - statsAt > STATS_REFRESH_MS) {
    statsAt = now;
    stats = usageStats(accountList, now);
  }
  return { now, accounts, players, stats, weather: weatherNow() };
}
