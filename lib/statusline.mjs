import fs from 'node:fs/promises';
import path from 'node:path';
import { STATUSLINE_DIR, STATUSLINE_PRUNE_AFTER_MS } from '../config.mjs';

const QUOTAS = { fiveHour: 'five_hour', sevenDay: 'seven_day' };

const cache = new Map();

/**
 * Quota d'un compte d'après toutes ses sessions. Chacune ne connaît que le chiffre de son dernier appel à l'API,
 * et une session inactive le renvoie tel quel pendant des heures : prendre la copie la plus récente donne un chiffre
 * au hasard. Dans une même fenêtre l'usage ne fait que monter, donc le plus haut chiffre de la fenêtre en cours
 * est le plus à jour.
 */
function freshestQuota(limits, now) {
  let best = null;
  let known = false;
  for (const limit of limits) {
    if (typeof limit?.used_percentage !== 'number' || !limit.resets_at) continue;
    known = true;
    const resetsAt = limit.resets_at * (limit.resets_at < 1e12 ? 1000 : 1);
    if (resetsAt <= now) continue;
    if (!best || resetsAt > best.resetsAt || (resetsAt === best.resetsAt && limit.used_percentage > best.usedPct)) {
      best = { usedPct: limit.used_percentage, resetsAt };
    }
  }
  // Fenêtre remise à zéro et aucun appel depuis : rien n'a encore été consommé.
  return best ?? (known ? { usedPct: 0, resetsAt: null } : null);
}

async function readCopy(file, stat) {
  const cached = cache.get(file);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.data;
  let data = null;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    // Copie en cours d'écriture : on garde l'ancienne.
    return cached?.data ?? null;
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, data });
  return data;
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Contexte et coût de chaque session, quotas de chaque compte, d'après les copies de la status line
 * (`<compte>/<session>.json`).
 */
export async function readStatuslines(now, accounts) {
  const sessions = new Map();
  const usage = Object.fromEntries(accounts.map((account) => [account.id, null]));
  for (const { id: accountId } of accounts) {
    const limits = [];
    const dir = path.join(STATUSLINE_DIR, accountId);
    for (const name of await listDir(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > STATUSLINE_PRUNE_AFTER_MS) {
        await fs.rm(file, { force: true });
        cache.delete(file);
        continue;
      }
      const data = await readCopy(file, stat);
      if (!data) continue;
      const window = data.context_window ?? {};
      sessions.set(`${accountId}:${name.slice(0, -5)}`, {
        context: {
          tokens: window.total_input_tokens ?? null,
          size: window.context_window_size ?? null,
          pct: window.used_percentage ?? null,
        },
        costUSD: data.cost?.total_cost_usd ?? null,
        model: data.model?.display_name ?? null,
      });
      if (data.rate_limits) limits.push(data.rate_limits);
    }
    if (limits.length) {
      usage[accountId] = Object.fromEntries(Object.entries(QUOTAS).map(([key, field]) => [
        key,
        freshestQuota(limits.map((limit) => limit[field]), now),
      ]));
    }
  }
  return { sessions, usage };
}
