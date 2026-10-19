import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Lecture au fil de l'eau des transcripts : chaque fichier n'est lu qu'une fois, puis seulement ce qui s'y ajoute.
// On en tire la liste de tâches de chaque session et les tokens consommés heure par heure.

// Poids des tokens dans le coût, d'après les tarifs Anthropic : la sortie coûte 5 fois l'entrée,
// l'écriture en cache 1,25 fois, la lecture du cache 0,1 fois.
const COST_WEIGHTS = { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 };
const CHUNK_BYTES = 4 * 1024 * 1024;
// Fichiers suivis pour les statistiques : ceux touchés depuis moins de deux jours.
const RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const TASK_CREATED = /Task #(\d+) created/;

const files = new Map();

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
    seenMessages: new Set(),
    pendingTasks: new Map(),
    tasks: new Map(),
    weight: 0,
    firstAt: null,
    // `${jour} ${heure}` -> { tokens, weight }
    hours: new Map(),
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
      const input = block.input ?? {};
      if (block.name === 'TaskCreate') state.pendingTasks.set(block.id, taskFromInput(input));
      else if (block.name === 'TaskUpdate' && input.taskId != null) {
        const task = state.tasks.get(String(input.taskId));
        if (!task) continue;
        if (input.status === 'deleted') state.tasks.delete(String(input.taskId));
        else Object.assign(task, input.status ? { status: input.status } : {}, input.subject ? { subject: input.subject } : {},
          input.activeForm ? { activeForm: input.activeForm } : {});
      } else if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
        // Ancien outil de liste : il réécrit toute la liste à chaque fois.
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

function handleLine(state, line) {
  if (!line) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  if (at && !state.firstAt) state.firstAt = at;
  const message = entry.message;
  // Un même appel est écrit en plusieurs entrées (réflexion, texte, outil) qui répètent son usage : on ne le compte qu'une fois.
  if (entry.type === 'assistant' && message?.usage && message.id && !state.seenMessages.has(message.id)) {
    state.seenMessages.add(message.id);
    const usage = message.usage;
    const parts = {
      input: usage.input_tokens ?? 0,
      cacheCreation: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    };
    const tokens = parts.input + parts.cacheCreation + parts.cacheRead + parts.output;
    const weight = Object.entries(parts).reduce((sum, [key, value]) => sum + value * COST_WEIGHTS[key], 0);
    state.weight += weight;
    if (at) {
      const key = `${localDay(at)} ${new Date(at).getHours()}`;
      const bucket = state.hours.get(key) ?? { tokens: 0, weight: 0 };
      bucket.tokens += tokens;
      bucket.weight += weight;
      state.hours.set(key, bucket);
    }
  }
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
    // On repart après la dernière ligne complète : celle en cours d'écriture sera relue au prochain passage.
    state.offset += consumed;
  } finally {
    await handle.close();
  }
}

/**
 * Met à jour le suivi d'un fichier : ne lit que ce qui a été ajouté depuis le dernier passage.
 */
export async function trackFile(file, account, sessionId, subagent = false) {
  let state = files.get(file);
  if (!state) {
    state = newState(account, sessionId, subagent);
    files.set(file, state);
  }
  if (state.reading) return state.reading;
  state.reading = (async () => {
    try {
      const { size } = await fs.stat(file);
      if (size < state.offset) Object.assign(state, newState(account, sessionId, subagent));
      if (size > state.offset) await readNew(file, state, size);
    } catch {
      // Fichier supprimé ou illisible : on garde ce qu'on en savait.
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

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Passe sur tous les transcripts récents de chaque compte (sessions et sous-agents).
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
 * Statistiques du jour par compte : tokens et coût heure par heure, chats lancés, agents recrutés.
 * Le coût vient du prix moyen du token pondéré, mesuré sur les sessions dont la status line donne le coût :
 * c'est une estimation.
 */
export function dayStats(accountList, knownCosts, now = Date.now()) {
  const today = localDay(now);
  const accounts = Object.fromEntries(accountList.map((account) => [account.id, {
    hours: Array.from({ length: 24 }, () => ({ tokens: 0, weight: 0 })),
    sessions: 0,
    agents: 0,
    knownCost: 0,
    knownWeight: 0,
  }]));
  const weightBySession = new Map();
  for (const state of files.values()) {
    const target = accounts[state.account];
    if (!target) continue;
    const sessionKey = `${state.account}:${state.sessionId}`;
    weightBySession.set(sessionKey, (weightBySession.get(sessionKey) ?? 0) + state.weight);
    if (state.firstAt && localDay(state.firstAt) === today) {
      if (state.subagent) target.agents += 1;
      else target.sessions += 1;
    }
    for (const [key, bucket] of state.hours) {
      const [day, hour] = key.split(' ');
      if (day !== today) continue;
      target.hours[Number(hour)].tokens += bucket.tokens;
      target.hours[Number(hour)].weight += bucket.weight;
    }
  }
  for (const [sessionKey, cost] of knownCosts) {
    const weight = weightBySession.get(sessionKey);
    if (!cost || !weight) continue;
    const target = accounts[sessionKey.split(':')[0]];
    target.knownCost += cost;
    target.knownWeight += weight;
  }
  const allCost = Object.values(accounts).reduce((sum, account) => sum + account.knownCost, 0);
  const allWeight = Object.values(accounts).reduce((sum, account) => sum + account.knownWeight, 0);
  return {
    day: today,
    accounts: Object.fromEntries(Object.entries(accounts).map(([id, account]) => {
      const rate = account.knownWeight ? account.knownCost / account.knownWeight : allWeight ? allCost / allWeight : null;
      const hours = account.hours.map(({ tokens, weight }) => ({ tokens, cost: rate == null ? null : weight * rate }));
      return [id, {
        hours,
        tokens: hours.reduce((sum, hour) => sum + hour.tokens, 0),
        cost: rate == null ? null : hours.reduce((sum, hour) => sum + hour.cost, 0),
        sessions: account.sessions,
        agents: account.agents,
      }];
    })),
  };
}
