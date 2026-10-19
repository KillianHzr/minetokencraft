import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNTS_REFRESH_MS } from '../config.mjs';
import { getSettings } from './settings.mjs';
import { credentialsFileExists, keychainItemExists, limitsFor } from './limits.mjs';

// Les comptes Claude Code de la machine : un compte = un dossier de config (`~/.claude` par défaut, ou celui que
// désigne CLAUDE_CONFIG_DIR). On les trouve seuls, sans configuration :
// - les dossiers de CLAUDE_CONFIG_DIR (plusieurs, séparés par des virgules) ;
// - `~/.claude` et `~/.config/claude` ;
// - les dossiers `~/.claude-*` et `~/.claude_*` (un par compte, l'usage courant pour en avoir plusieurs) ;
// - les dossiers ajoutés dans les réglages.
// Un dossier compte s'il a déjà servi : il contient des sessions, des transcripts ou des identifiants.

const home = os.homedir();
const MARKERS = ['projects', 'sessions', '.credentials.json'];

let cache = { at: 0, accounts: [] };

/**
 * Identifiant d'un compte, tiré du nom de son dossier : `~/.claude` → claude, `~/.claude-work` → claude-work.
 * La copie de la status line (scripts/statusline.mjs) le calcule de la même façon.
 */
export function accountIdFor(dir) {
  const name = path.basename(dir).replace(/^\./, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
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
    // Dossier personnel illisible : on s'en tient aux autres sources.
  }
  return [path.join(home, '.claude'), path.join(home, '.config', 'claude'), ...fromEnv, ...siblings, ...settings.extraDirs];
}

/**
 * Où Claude Code range le profil du compte (adresse, organisation) : dans le dossier de config quand il est
 * désigné par CLAUDE_CONFIG_DIR, sinon dans `~/.claude.json`.
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
    accounts.push({ id, dir, label: own.label || id, hidden: Boolean(own.hidden) });
  }
  // Rang d'affichage (couleur, style de l'aile) : dans l'ordre de découverte, comptes masqués exclus.
  let slot = 0;
  for (const account of accounts) if (!account.hidden) account.slot = slot++;
  return accounts;
}

/**
 * Tous les comptes trouvés, masqués compris (les réglages les listent) ; relus toutes les minutes.
 */
export async function allAccounts({ fresh = false } = {}) {
  if (fresh || Date.now() - cache.at > ACCOUNTS_REFRESH_MS) cache = { at: Date.now(), accounts: await discover() };
  return cache.accounts;
}

/**
 * Comptes affichés : ceux que l'utilisateur n'a pas masqués.
 */
export async function listAccounts() {
  return (await allAccounts()).filter((account) => !account.hidden);
}

/**
 * Comptes pour l'écran de réglages : dossier, libellé, rang, d'où viennent les quotas. Aucun secret.
 */
export async function accountsOverview() {
  const settings = await getSettings();
  return Promise.all((await allAccounts({ fresh: true })).map(async (account) => {
    const own = settings.accounts[account.id] ?? {};
    const limits = limitsFor(account.id);
    return {
      id: account.id,
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
