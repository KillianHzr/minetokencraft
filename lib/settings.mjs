import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR } from '../config.mjs';

// User settings, in a file readable by the user only: it may contain claude.ai session keys.
// Keys never go back to the page: it only learns that a key is saved.

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  // Desktop notifications are off by default: turn them on with the toolbar notifications button.
  notifications: false,
  // Per account (key: id): { label, hidden, sessionKey, keychain }. `keychain`: the user allows
  // reading the Claude Code token from the macOS Keychain.
  accounts: {},
  // Claude Code config folders added by hand, on top of the ones found automatically.
  extraDirs: [],
  // Weather city; empty: the one of the machine's time zone.
  city: '',
  // Language of desktop notifications and of the command line, chosen in the page; empty: the system language.
  language: '',
};
const LANGUAGES = ['en', 'fr'];
const SESSION_KEY = /^sk-ant-[A-Za-z0-9_-]{20,2000}$/;

// Path typed in the page (`~/…` accepted) made absolute.
const absolute = (dir) => path.resolve(dir.trim().replace(/^~(?=$|[\\/])/, os.homedir()));

let settings = null;

export async function getSettings() {
  if (!settings) {
    let saved = {};
    try {
      saved = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    } catch {
      // No settings yet: default values.
    }
    settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  }
  return settings;
}

async function save() {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  // A file created before this setting keeps its permissions: tighten them.
  await fs.chmod(SETTINGS_FILE, 0o600);
}

/**
 * Settings as the page may see them: session keys are replaced by a simple flag.
 */
export async function publicSettings() {
  const current = await getSettings();
  return {
    notifications: current.notifications,
    city: current.city,
    language: current.language,
    extraDirs: current.extraDirs,
    accounts: Object.fromEntries(Object.entries(current.accounts).map(([id, account]) => [id, {
      label: account.label ?? '',
      hidden: Boolean(account.hidden),
      keychain: Boolean(account.keychain),
      hasSessionKey: Boolean(account.sessionKey),
    }])),
  };
}

/**
 * Applies a change coming from the page. Each field is validated: anything else is ignored.
 */
export async function updateSettings(patch) {
  const current = await getSettings();
  if (typeof patch.notifications === 'boolean') current.notifications = patch.notifications;
  if (typeof patch.city === 'string') current.city = patch.city.trim().slice(0, 80);
  if (LANGUAGES.includes(patch.language) || patch.language === '') current.language = patch.language;
  if (typeof patch.addDir === 'string' && patch.addDir.trim()) {
    const dir = absolute(patch.addDir);
    if (!current.extraDirs.includes(dir)) current.extraDirs.push(dir);
  }
  if (typeof patch.removeDir === 'string') current.extraDirs = current.extraDirs.filter((dir) => dir !== absolute(patch.removeDir));
  for (const [id, change] of Object.entries(patch.accounts ?? {})) {
    if (!/^[a-z0-9_-]{1,64}$/.test(id) || typeof change !== 'object' || !change) continue;
    const account = current.accounts[id] ?? {};
    if (typeof change.label === 'string') account.label = change.label.trim().slice(0, 40);
    if (typeof change.hidden === 'boolean') account.hidden = change.hidden;
    if (typeof change.keychain === 'boolean') account.keychain = change.keychain;
    if (change.sessionKey === null) delete account.sessionKey;
    else if (typeof change.sessionKey === 'string') {
      const key = change.sessionKey.trim();
      if (!SESSION_KEY.test(key)) throw Object.assign(new Error('invalid session key: it starts with sk-ant-'), { code: 'sessionKeyFormat' });
      account.sessionKey = key;
    }
    current.accounts[id] = account;
  }
  await save();
  return publicSettings();
}
