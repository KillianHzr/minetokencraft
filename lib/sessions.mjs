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
import { dayStats, rescanAll, tasksOf, trackFile } from './tracker.mjs';
import { gitStatus } from './git.mjs';
import { forecastFor, recordUsage } from './forecast.mjs';
import { weatherNow } from './weather.mjs';
import { listAccounts } from './accounts.mjs';
import { limitsFor } from './limits.mjs';

const run = promisify(execFile);
const home = os.homedir();
// Dossiers trop génériques pour nommer un projet seuls : on garde aussi leur parent.
const GENERIC_DIRS = new Set(['staging', 'main', 'master', 'develop', 'current', 'dev', 'src', 'app', 'www', 'html']);
// Un sous-agent qui vient d'écrire du texte peut encore enchaîner sur un outil : on attend avant de le dire fini.
const VILLAGER_SETTLE_MS = 15 * 1000;
const SHOWN_KINDS = new Set(['interactive', 'bg']);
// Statistiques du jour : recalculées toutes les 30 s, les transcripts de tout le monde repassés toutes les minutes.
const STATS_REFRESH_MS = 30 * 1000;
const RESCAN_MS = 60 * 1000;
const TASKS_LISTED = 12;

const transcriptDirs = new Map();
// Dernière photographie côté serveur : de quoi retrouver le transcript et le pid d'un joueur (historique, terminal).
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

async function claudePids() {
  const { stdout } = await run('ps', ['-axo', 'pid=,comm=']);
  const pids = new Set();
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match && match[2].includes('claude')) pids.add(Number(match[1]));
  }
  return pids;
}

function projectLabel(cwd) {
  if (!cwd || cwd === home) return '~';
  const parts = cwd.split('/').filter(Boolean);
  const last = parts.at(-1);
  return GENERIC_DIRS.has(last) && parts.length > 1 ? `${parts.at(-2)}/${last}` : last;
}

/**
 * Dossier du transcript d'une session : celui que Claude Code dérive du cwd, sinon on cherche dans tous les projets.
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

async function collectVillagers(subagentsDir, now) {
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
    const done = summary.handback || silentFor > VILLAGER_STALE_MS
      || (summary.lastKind === 'text' && silentFor > VILLAGER_SETTLE_MS);
    if (done && silentFor > VILLAGER_LINGER_MS) continue;
    const meta = await readJson(path.join(subagentsDir, `agent-${match[1]}.meta.json`)) ?? {};
    villagers.push({
      id: match[1],
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
 * Remplissage du contexte : la status line connaît la taille de la fenêtre, le transcript le dernier appel.
 * Une session reprise sans nouvel appel, ou une tâche de fond sans status line, n'a que l'un des deux.
 */
function contextOf(statusline, summary) {
  const size = statusline?.context.size ?? null;
  const tokens = statusline?.context.tokens || summary.contextTokens || null;
  const pct = statusline?.context.pct ?? (tokens && size ? Math.round((tokens / size) * 100) : null);
  return { tokens, size, pct };
}

/**
 * Avancement de la liste de tâches de la session (TaskCreate / TaskUpdate), s'il y en a une.
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
  // Conversation reprise dans une autre session (tâche de fond) : c'est celle-là qu'on montre.
  if (summary.continuedIn) return null;
  const villagers = projectDir
    ? await collectVillagers(path.join(projectDir, registry.sessionId, 'subagents'), now)
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
  known.set(id, { file: transcriptFile, pid: registry.pid, cwd: registry.cwd });
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
    // Au travail mais plus rien d'écrit depuis un moment : commande très longue, ou session coincée.
    stuck: status === 'working' && registry.status === 'busy' && now - lastActivityAt > STUCK_AFTER_MS,
    tasks: transcriptFile ? taskProgress(transcriptFile) : null,
    git: gitStatus(registry.cwd),
    tool: status === 'working' && registry.status !== 'idle' ? summary.tool ?? null : null,
    thinking: status === 'working' && registry.status === 'busy' && !summary.tool,
    lastPrompt: summary.lastPrompt ?? null,
    lastText: summary.lastText ?? null,
    context: contextOf(statusline, summary),
    // Après une reprise, la status line repart de 0 $ alors que le transcript garde le cumul.
    costUSD: statusline?.costUSD || summary.costUSD || null,
    model: statusline?.model ?? summary.model ?? null,
    startedAt: registry.startedAt ?? null,
    lastActivityAt,
    villagers,
  };
}

/**
 * Photographie de toutes les sessions Claude vivantes des comptes configurés.
 */
export async function collectState() {
  const now = Date.now();
  const accountList = await listAccounts();
  const [alive, { sessions: statuslines, usage }] = await Promise.all([claudePids(), readStatuslines(now, accountList)]);
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
  // Quotas : ceux d'Anthropic quand ils sont récents, sinon ceux de la status line.
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
    rescanAll(accountList, now).catch((error) => console.error('lecture des transcripts impossible :', error));
  }
  if (now - statsAt > STATS_REFRESH_MS) {
    statsAt = now;
    const knownCosts = new Map(players.filter((player) => player.costUSD).map((player) => [`${player.account}:${player.sessionId}`, player.costUSD]));
    stats = dayStats(accountList, knownCosts, now);
  }
  return { now, accounts, players, stats, weather: weatherNow() };
}
