import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { LIMITS_BACKOFF_MAX_MS, LIMITS_BACKOFF_MS, LIMITS_REFRESH_MS } from '../config.mjs';
import { listAccounts, profileFileFor } from './accounts.mjs';
import { getSettings } from './settings.mjs';

// Official quotas of each account (5-hour and weekly), requested from Anthropic:
// 1. with the Claude Code login: the token is in `<folder>/.credentials.json`, or in the macOS Keychain
//    (service "Claude Code-credentials", followed for a folder other than ~/.claude by a hash of its path);
//    the Keychain is only read for accounts where the user allowed it, macOS then asking for permission;
// 2. otherwise, with a claude.ai session key pasted in the settings.
// The token is never refreshed here: it rotates on every refresh, and doing it in place of Claude Code
// would log it out. An expired token is re-read later, once Claude Code has renewed it.

const run = promisify(execFile);
const home = os.homedir();
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_AI_API = 'https://claude.ai/api';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
// A token that expires within the minute is already considered expired.
const EXPIRY_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
// Time to answer the Keychain access prompt.
const KEYCHAIN_TIMEOUT_MS = 60 * 1000;
// Beyond this, quotas read from Anthropic are too old: the status line takes over again.
export const LIMITS_STALE_MS = 15 * 60 * 1000;
const CHECK_EVERY_MS = 20 * 1000;
// claude.ai refuses clients that do not look like a browser.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// Par compte : { usage, plan, source, at, error, nextAt, backoffMs, token, organizationId }.
const states = new Map();

function stateOf(id) {
  if (!states.has(id)) states.set(id, { nextAt: 0, backoffMs: 0 });
  return states.get(id);
}

// `code` names the problem for the page, which words it in its own language (quotaError.<code>).
class LimitsError extends Error {
  constructor(code, { status = null, retryAfterMs = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const ERROR_CODES = new Set(['keychainDenied', 'tooManyRequests', 'cloudflare', 'http', 'sessionKeyInvalid', 'noOrganization']);
// Anything else (timeout, no network) is a network error.
const errorOf = (error) => ({ code: ERROR_CODES.has(error.code) ? error.code : 'network', status: error.status ?? null });

const hash8 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);

/**
 * Keychain services where Claude Code may have stored a folder's token. It hashes the path as is: we try
 * the absolute path and the real path, with and without a trailing slash.
 */
async function keychainServices(dir) {
  const absolute = path.resolve(dir);
  if (absolute === path.join(home, '.claude')) return [KEYCHAIN_SERVICE];
  const real = await fs.realpath(absolute).catch(() => absolute);
  const variants = [...new Set([absolute, `${absolute}/`, real, `${real}/`])];
  return variants.map((variant) => `${KEYCHAIN_SERVICE}-${hash8(variant)}`);
}

export async function keychainItemExists(dir) {
  if (process.platform !== 'darwin') return false;
  for (const service of await keychainServices(dir)) {
    try {
      // Without -w, only the attributes are read: no authorization prompt.
      await run('security', ['find-generic-password', '-s', service], { timeout: REQUEST_TIMEOUT_MS });
      return true;
    } catch {
      // No item under this name: try the next one.
    }
  }
  return false;
}

function credentialFrom(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const oauth = data?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  const expires = Number(oauth.expiresAt) || 0;
  return {
    token: oauth.accessToken,
    // Usually milliseconds; a value in seconds is accepted.
    expiresAt: expires > 1e10 ? expires : expires * 1000,
    plan: planLabel(oauth.subscriptionType, oauth.rateLimitTier),
  };
}

/**
 * Formule lisible : « Max 20x », « Pro », « Team »…
 */
function planLabel(subscription, tier) {
  if (!subscription) return null;
  const name = String(subscription).charAt(0).toUpperCase() + String(subscription).slice(1);
  const multiplier = String(tier ?? '').match(/(\d+x)$/)?.[1];
  return multiplier ? `${name} ${multiplier}` : name;
}

const usable = (credential) => credential && (!credential.expiresAt || credential.expiresAt - EXPIRY_MARGIN_MS > Date.now());

export async function credentialsFileExists(dir) {
  return fs.stat(path.join(dir, '.credentials.json')).then(() => true, () => false);
}

async function readKeychain(dir) {
  const user = os.userInfo().username;
  for (const service of await keychainServices(dir)) {
    for (const args of [['-a', user], []]) {
      try {
        const { stdout } = await run('security', ['find-generic-password', '-s', service, ...args, '-w'], { timeout: KEYCHAIN_TIMEOUT_MS });
        const credential = credentialFrom(stdout.trim());
        if (credential) return credential;
      } catch (error) {
        // Access denied in the macOS prompt: no point asking again for the other names.
        if (/canceled|denied|User interaction/i.test(error.stderr ?? '')) throw new LimitsError('keychainDenied');
      }
    }
  }
  return null;
}

/**
 * Login token of an account: the one kept in memory if still valid, else the file, else the
 * Keychain when the user allowed it.
 */
async function connectionToken(account, own, state) {
  if (usable(state.credential)) return state.credential;
  try {
    const credential = credentialFrom(await fs.readFile(path.join(account.dir, '.credentials.json'), 'utf8'));
    if (usable(credential)) return (state.credential = credential);
  } catch {
    // No file: the token is probably in the Keychain.
  }
  if (process.platform === 'darwin' && own.keychain) {
    const credential = await readKeychain(account.dir);
    if (usable(credential)) return (state.credential = credential);
  }
  return null;
}

async function request(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new LimitsError('tooManyRequests', { status: 429, retryAfterMs: seconds > 0 ? seconds * 1000 : null });
  }
  if (response.headers.get('cf-mitigated')) throw new LimitsError('cloudflare', { status: response.status });
  if (!response.ok) throw new LimitsError('http', { status: response.status });
  return response.json();
}

function quota(window) {
  if (!window || typeof window.utilization !== 'number') return null;
  return { usedPct: window.utilization, resetsAt: window.resets_at ? Date.parse(window.resets_at) : null };
}

function usageFrom(data) {
  return { fiveHour: quota(data.five_hour), sevenDay: quota(data.seven_day) };
}

async function oauthUsage(credential) {
  return usageFrom(await request(USAGE_URL, { Authorization: `Bearer ${credential.token}`, 'anthropic-beta': 'oauth-2025-04-20' }));
}

/**
 * Quotas via claude.ai: we pick the account's organization (the one in the Claude Code profile if found, else the
 * first one with usage, else the first), then keep it in memory.
 */
async function sessionKeyUsage(account, sessionKey, state) {
  const headers = {
    Cookie: `sessionKey=${sessionKey}`,
    Accept: 'application/json',
    'User-Agent': BROWSER_USER_AGENT,
    Referer: 'https://claude.ai',
    Origin: 'https://claude.ai',
  };
  const usageOf = async (organizationId) => usageFrom(await request(`${CLAUDE_AI_API}/organizations/${encodeURIComponent(organizationId)}/usage`, headers));
  if (state.organizationId) {
    try {
      return await usageOf(state.organizationId);
    } catch (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
    }
  }
  let organizations;
  try {
    organizations = await request(`${CLAUDE_AI_API}/organizations`, headers);
  } catch (error) {
    // An expired key answers 401 or 403.
    if (error.status === 401 || error.status === 403) throw new LimitsError('sessionKeyInvalid', { status: error.status });
    throw error;
  }
  const chat = organizations.filter((organization) => !organization.capabilities || organization.capabilities.includes('chat'));
  const candidates = chat.length ? chat : organizations;
  const profile = await fs.readFile(profileFileFor(account.dir), 'utf8').then(JSON.parse).catch(() => null);
  const preferred = candidates.find((organization) => organization.uuid === profile?.oauthAccount?.organizationUuid);
  for (const organization of preferred ? [preferred, ...candidates] : candidates) {
    try {
      const usage = await usageOf(organization.uuid);
      if (organization === preferred || usage.fiveHour?.usedPct || usage.sevenDay?.usedPct || organization === candidates.at(-1)) {
        state.organizationId = organization.uuid;
        return usage;
      }
    } catch (error) {
      if (error.status === 429) throw error;
    }
  }
  throw new LimitsError('noOrganization');
}

async function poll(account) {
  const settings = await getSettings();
  const own = settings.accounts[account.id] ?? {};
  const state = stateOf(account.id);
  const errors = [];
  try {
    const credential = await connectionToken(account, own, state);
    if (credential) {
      try {
        Object.assign(state, { usage: await oauthUsage(credential), plan: credential.plan, source: 'oauth', at: Date.now(), error: null });
        return;
      } catch (error) {
        // Token rejected: forget it, it will be re-read on the next tick.
        if (error.status === 401 || error.status === 403) state.credential = null;
        if (error.status === 429) throw error;
        errors.push(errorOf(error));
      }
    }
    if (own.sessionKey) {
      Object.assign(state, { usage: await sessionKeyUsage(account, own.sessionKey, state), source: 'sessionKey', at: Date.now(), error: null });
      return;
    }
    state.error = errors[0] ?? null;
  } catch (error) {
    state.error = errorOf(error);
    if (error.status === 429) {
      state.backoffMs = error.retryAfterMs ?? (state.backoffMs ? Math.min(state.backoffMs * 2, LIMITS_BACKOFF_MAX_MS) : LIMITS_BACKOFF_MS);
      state.nextAt = Date.now() + state.backoffMs;
      return;
    }
  }
  state.backoffMs = 0;
}

async function tick() {
  const now = Date.now();
  for (const account of await listAccounts()) {
    const state = stateOf(account.id);
    if (state.busy || now < state.nextAt) continue;
    state.busy = true;
    state.nextAt = now + LIMITS_REFRESH_MS;
    poll(account).finally(() => (state.busy = false));
  }
}

export function startLimits() {
  tick();
  setInterval(tick, CHECK_EVERY_MS);
}

/**
 * Re-reads an account's quotas right away (after a setting change: session key, Keychain access).
 */
export async function refreshLimits(accountId) {
  const account = (await listAccounts()).find((candidate) => candidate.id === accountId);
  if (!account) return;
  const state = stateOf(accountId);
  state.credential = null;
  state.nextAt = Date.now() + LIMITS_REFRESH_MS;
  await poll(account);
}

/**
 * Latest known quotas of an account, if recent enough, with their source and formula.
 */
export function limitsFor(accountId) {
  const state = states.get(accountId);
  if (!state) return null;
  const fresh = state.at && Date.now() - state.at < LIMITS_STALE_MS;
  return { usage: fresh ? state.usage : null, source: fresh ? state.source : null, plan: state.plan ?? null, error: state.error ?? null };
}
