import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR } from '../config.mjs';

// Réglages de l'utilisateur, dans un fichier lisible par lui seul : il peut contenir des clés de session claude.ai.
// Les clés ne repartent jamais vers la page : elle apprend seulement qu'une clé est enregistrée.

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  // Notifications macOS coupées par défaut : on les allume avec le bouton « Notifs Mac ».
  notifications: false,
  // Par compte (clé : identifiant) : { label, hidden, sessionKey, keychain }. `keychain` : l'utilisateur autorise la
  // lecture du jeton de Claude Code dans le trousseau macOS.
  accounts: {},
  // Dossiers de config Claude Code ajoutés à la main, en plus de ceux trouvés seuls.
  extraDirs: [],
  // Ville de la météo ; vide : celle du fuseau horaire de la machine.
  city: '',
};
const SESSION_KEY = /^sk-ant-[A-Za-z0-9_-]{20,2000}$/;

// Chemin saisi dans la page (`~/…` accepté) rendu absolu.
const absolute = (dir) => path.resolve(dir.trim().replace(/^~(?=$|\/)/, os.homedir()));

let settings = null;

export async function getSettings() {
  if (!settings) {
    let saved = {};
    try {
      saved = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    } catch {
      // Pas encore de réglages : valeurs par défaut.
    }
    settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  }
  return settings;
}

async function save() {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  // Un fichier créé avant ce réglage garde ses droits : on les resserre.
  await fs.chmod(SETTINGS_FILE, 0o600);
}

/**
 * Réglages tels que la page peut les voir : les clés de session sont remplacées par un simple indicateur.
 */
export async function publicSettings() {
  const current = await getSettings();
  return {
    notifications: current.notifications,
    city: current.city,
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
 * Applique une modification venue de la page. Chaque champ est vérifié : le reste est ignoré.
 */
export async function updateSettings(patch) {
  const current = await getSettings();
  if (typeof patch.notifications === 'boolean') current.notifications = patch.notifications;
  if (typeof patch.city === 'string') current.city = patch.city.trim().slice(0, 80);
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
      if (!SESSION_KEY.test(key)) throw new Error('Clé de session invalide : elle commence par sk-ant-.');
      account.sessionKey = key;
    }
    current.accounts[id] = account;
  }
  await save();
  return publicSettings();
}
