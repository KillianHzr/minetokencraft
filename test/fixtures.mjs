// A fake machine for the tests: a home folder with Claude Code config folders, transcripts, sub-agents, session
// registries and status line copies, all in a temporary folder. Nothing here touches the real ~/.claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MINUTE = 60 * 1000;

/**
 * Creates the fake home and points every variable the server reads at it. Call it before importing any server
 * module: they read the home folder when they load.
 */
export function fakeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minetokencraft-test-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    LANG: 'en_US.UTF-8',
  });
  delete process.env.CLAUDE_CONFIG_DIR;
  return { root, home, cache: path.join(root, 'cache', 'minetokencraft'), config: path.join(root, 'config', 'minetokencraft') };
}

const iso = (at) => new Date(at).toISOString();

export const entries = {
  user: (at, text) => ({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } }),
  toolResult: (at, toolUseId, text) => ({
    type: 'user', timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  }),
  assistant: (at, { id, requestId = `req_${id}`, model = 'claude-opus-5-5', usage = {}, content, sidechain = false }) => ({
    type: 'assistant',
    timestamp: iso(at),
    requestId,
    isSidechain: sidechain,
    message: {
      id,
      model,
      role: 'assistant',
      content: content ?? [{ type: 'text', text: `answer ${id}` }],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
    },
  }),
  toolUse: (id, name, input) => ({ type: 'tool_use', id, name, input }),
  title: (aiTitle) => ({ type: 'ai-title', aiTitle }),
  costState: (total, models) => ({
    type: 'cost-state',
    totalCostUSD: total,
    modelUsage: Object.fromEntries(Object.entries(models).map(([model, costUSD]) => [model, { costUSD }])),
  }),
  identity: (modelId) => ({ type: 'attachment', attachment: { type: 'identity', identity: { modelId } } }),
};

export function writeJsonl(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export function appendJsonl(file, lines) {
  fs.appendFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/**
 * Folder where Claude Code keeps the transcripts of a working directory.
 */
export function projectDir(configDir, cwd) {
  return path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/**
 * A live session: its registry file, its transcript and, optionally, its sub-agents.
 */
export function session(configDir, { pid, sessionId, cwd, status = 'busy', at, transcript = [], agents = [], ...registry }) {
  writeJson(path.join(configDir, 'sessions', `${pid}.json`), {
    pid, sessionId, cwd, kind: 'interactive', status, startedAt: at, statusUpdatedAt: at, nameSource: 'derived', name: path.basename(cwd), ...registry,
  });
  const dir = projectDir(configDir, cwd);
  writeJsonl(path.join(dir, `${sessionId}.jsonl`), transcript);
  for (const agent of agents) {
    const agentsDir = path.join(dir, sessionId, 'subagents');
    writeJsonl(path.join(agentsDir, `agent-${agent.id}.jsonl`), agent.transcript);
    writeJson(path.join(agentsDir, `agent-${agent.id}.meta.json`), { agentType: agent.type, description: agent.description });
  }
  return path.join(dir, `${sessionId}.jsonl`);
}
