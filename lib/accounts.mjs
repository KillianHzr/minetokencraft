import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNTS_REFRESH_MS } from '../config.mjs';
import { getSettings } from './settings.mjs';
import { credentialsFileExists, keychainItemExists, limitsFor } from './limits.mjs';
import { ASSISTANTS, assistantFor } from './assistants/index.mjs';

// The Claude Code accounts on the machine: one account = one config folder (`~/.claude` by default, or the one
// named by CLAUDE_CONFIG_DIR). They are found automatically, without configuration:
// - the folders in CLAUDE_CONFIG_DIR (several, comma-separated);
// - `~/.claude` and `~/.config/claude`;
// - the `~/.claude-*` and `~/.claude_*` folders (one per account, the usual way to have several);
// - the folders added in the settings.
// A folder counts if it has already been used: it contains sessions, transcripts or credentials.

const home = os.homedir();
const MARKERS = ['projects', 'sessions', '.credentials.json'];

let cache = { at: 0, accounts: [] };

/**
 * Identifier of an account, derived from its folder name: `~/.claude` → claude, `~/.claude-work` → claude-work.
 * The status line copy (scripts/statusline.mjs) computes it the same way.
 */
export function accountIdFor(dir) {
  // Both separators: a Windows path keeps its backslashes wherever it is read.
  const folder = String(dir).split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  const name = folder.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'claude';
}

async function hasBeenUsed(dir) {
  for (const marker of MARKERS) {
    if (await fs.stat(path.join(dir, marker)).then(() => true, () => false)) return true;
  }
  return false;
}

async function candidateDirs(settings) {
  const fromEnv = (process.env.CLAUDE_CONFIG_DIR ?? '').split(',').map((dir) => dir.trim()).filter(Boolean);
  let siblings = [];
  try {
    siblings = (await fs.readdir(home, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\.claude[-_]/.test(entry.name))
      .map((entry) => path.join(home, entry.name))
      .sort();
  } catch {
    // Home directory unreadable: stick to the other sources.
  }
  return [path.join(home, '.claude'), path.join(home, '.config', 'claude'), ...fromEnv, ...siblings, ...settings.extraDirs];
}

/**
 * Where Claude Code stores the account profile (address, organization): in the config folder when it is
 * set through CLAUDE_CONFIG_DIR, otherwise in `~/.claude.json`.
 */
export function profileFileFor(dir) {
  return path.resolve(dir) === path.join(home, '.claude') ? path.join(home, '.claude.json') : path.join(dir, '.claude.json');
}

async function discover() {
  const settings = await getSettings();
  const seen = new Set();
  const ids = new Set();
  const accounts = [];
  for (const candidate of await candidateDirs(settings)) {
    const dir = path.resolve(candidate);
    const real = await fs.realpath(dir).catch(() => null);
    if (!real || seen.has(real) || !(await hasBeenUsed(dir))) continue;
    seen.add(real);
    let id = accountIdFor(dir);
    for (let n = 2; ids.has(id); n++) id = `${accountIdFor(dir)}-${n}`;
    ids.add(id);
    const own = settings.accounts[id] ?? {};
    accounts.push({ id, dir, label: own.label || id, hidden: Boolean(own.hidden), tool: 'claude' });
  }
  // The other assistants found on the machine, one wing each, after the Claude Code accounts.
  for (const assistant of ASSISTANTS) {
    const dir = await assistant.find();
    if (!dir) continue;
    const own = settings.accounts[assistant.tool] ?? {};
    accounts.push({ id: assistant.tool, dir, label: own.label || assistant.label, hidden: Boolean(own.hidden), tool: assistant.tool });
  }
  // Display rank (color, wing style): in order of discovery, hidden accounts excluded.
  let slot = 0;
  for (const account of accounts) if (!account.hidden) account.slot = slot++;
  return accounts;
}

/**
 * All the accounts found, hidden ones included (the settings list them); re-read every minute.
 */
export async function allAccounts({ fresh = false } = {}) {
  if (fresh || Date.now() - cache.at > ACCOUNTS_REFRESH_MS) cache = { at: Date.now(), accounts: await discover() };
  return cache.accounts;
}

/**
 * Displayed accounts: those the user has not hidden.
 */
export async function listAccounts() {
  return (await allAccounts()).filter((account) => !account.hidden);
}

/**
 * Accounts for the settings screen: folder, label, rank, where the quotas come from. No secrets.
 */
export async function accountsOverview() {
  const settings = await getSettings();
  return Promise.all((await allAccounts({ fresh: true })).map(async (account) => {
    const own = settings.accounts[account.id] ?? {};
    if (account.tool !== 'claude') {
      // Another assistant: no login to read, its quotas come from its own logs.
      const read = assistantFor(account.tool).usage();
      return {
        id: account.id, tool: account.tool, label: account.label, dir: account.dir.startsWith(home) ? `~${account.dir.slice(home.length)}` : account.dir,
        hidden: account.hidden, slot: account.slot ?? null, plan: read?.plan ?? null, quotaSource: read?.usage ? 'logs' : null, quotaError: null, custom: false,
      };
    }
    const limits = limitsFor(account.id);
    return {
      id: account.id,
      tool: account.tool,
      label: account.label,
      dir: account.dir.startsWith(home) ? `~${account.dir.slice(home.length)}` : account.dir,
      hidden: account.hidden,
      slot: account.slot ?? null,
      plan: limits?.plan ?? null,
      quotaSource: limits?.source ?? null,
      quotaError: limits?.error ?? null,
      credentialsFile: await credentialsFileExists(account.dir),
      keychainItem: await keychainItemExists(account.dir),
      keychain: Boolean(own.keychain),
      hasSessionKey: Boolean(own.sessionKey),
      custom: settings.extraDirs.includes(account.dir),
    };
  }));
}
