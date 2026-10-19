import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR, FORECAST_WINDOW_MS, USAGE_SAMPLE_MS } from '../config.mjs';

// Prévision des quotas : on garde un échantillon par minute de chaque quota, et on en tire la pente
// de la dernière heure pour savoir à quelle heure il sera épuisé si on continue à ce rythme.

const HISTORY_FILE = path.join(CACHE_DIR, 'usage-history.json');
const QUOTAS = ['fiveHour', 'sevenDay'];
const KEEP_MS = 8 * 24 * 60 * 60 * 1000;
// Il faut au moins un quart d'heure d'historique pour parler de tendance.
const MIN_SPAN_MS = 15 * 60 * 1000;

let history = {};
let lastSampleAt = 0;
let loaded = false;

async function load() {
  loaded = true;
  try {
    history = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  } catch {
    history = {};
  }
}

async function save() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(`${HISTORY_FILE}.tmp`, JSON.stringify(history));
  await fs.rename(`${HISTORY_FILE}.tmp`, HISTORY_FILE);
}

/**
 * Note l'usage courant de chaque compte, au plus une fois par minute.
 */
export async function recordUsage(usageByAccount, now) {
  if (!loaded) await load();
  if (now - lastSampleAt < USAGE_SAMPLE_MS) return;
  lastSampleAt = now;
  for (const [accountId, usage] of Object.entries(usageByAccount)) {
    for (const quota of QUOTAS) {
      const value = usage?.[quota];
      if (!value?.resetsAt) continue;
      const key = `${accountId}:${quota}`;
      history[key] = (history[key] ?? []).filter((sample) => now - sample.at < KEEP_MS);
      history[key].push({ at: now, pct: value.usedPct, resetsAt: value.resetsAt });
    }
  }
  await save().catch(() => {});
}

/**
 * Heure prévue d'épuisement d'un quota au rythme de la dernière heure, ou `holds` s'il tient jusqu'à sa remise à zéro.
 */
function forecastOne(samples, current, now) {
  if (!current?.resetsAt || current.usedPct >= 100) return null;
  const recent = (samples ?? []).filter((sample) => sample.resetsAt === current.resetsAt && now - sample.at <= FORECAST_WINDOW_MS);
  if (recent.length < 2 || recent.at(-1).at - recent[0].at < MIN_SPAN_MS) return null;
  // Pente par les moindres carrés : moins sensible qu'un simple écart au premier échantillon.
  const meanAt = recent.reduce((sum, sample) => sum + sample.at, 0) / recent.length;
  const meanPct = recent.reduce((sum, sample) => sum + sample.pct, 0) / recent.length;
  const covariance = recent.reduce((sum, sample) => sum + (sample.at - meanAt) * (sample.pct - meanPct), 0);
  const variance = recent.reduce((sum, sample) => sum + (sample.at - meanAt) ** 2, 0);
  const slope = variance ? covariance / variance : 0;
  if (slope <= 0) return { holds: true, eta: null };
  const eta = now + (100 - current.usedPct) / slope;
  return eta >= current.resetsAt ? { holds: true, eta: null } : { holds: false, eta };
}

export function forecastFor(accountId, usage, now) {
  if (!usage) return null;
  return Object.fromEntries(QUOTAS.map((quota) => [quota, forecastOne(history[`${accountId}:${quota}`], usage[quota], now)]));
}
