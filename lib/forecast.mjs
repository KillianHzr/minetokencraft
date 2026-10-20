import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR, FORECAST_WINDOW_MS, USAGE_SAMPLE_MS } from '../config.mjs';

// Quota forecast: we keep one sample per minute of each quota, and derive the slope
// of the last hour to tell at what time it will run out if the pace continues.

const HISTORY_FILE = path.join(CACHE_DIR, 'usage-history.json');
const QUOTAS = ['fiveHour', 'sevenDay'];
const KEEP_MS = 8 * 24 * 60 * 60 * 1000;
// At least a quarter of an hour of history is needed to talk about a trend.
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
 * Records the current usage of each account, at most once per minute.
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
 * Projected exhaustion time of a quota at the pace of the last hour, or `holds` if it lasts until its reset.
 */
function forecastOne(samples, current, now) {
  if (!current?.resetsAt || current.usedPct >= 100) return null;
  const recent = (samples ?? []).filter((sample) => sample.resetsAt === current.resetsAt && now - sample.at <= FORECAST_WINDOW_MS);
  if (recent.length < 2 || recent.at(-1).at - recent[0].at < MIN_SPAN_MS) return null;
  // Least-squares slope: less sensitive than a simple difference from the first sample.
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
