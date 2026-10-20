import fs from 'node:fs/promises';
import path from 'node:path';
import { STATUSLINE_DIR, STATUSLINE_PRUNE_AFTER_MS } from '../config.mjs';

const QUOTAS = { fiveHour: 'five_hour', sevenDay: 'seven_day' };

const cache = new Map();

/**
 * Quota of an account based on all its sessions. Each one only knows the figure from its last API call,
 * and an idle session returns it unchanged for hours: taking the most recent copy gives a random figure.
 * Within one window usage only goes up, so the highest figure of the current window
 * is the most up to date.
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
  // Window reset and no call since: nothing has been consumed yet.
  return best ?? (known ? { usedPct: 0, resetsAt: null } : null);
}

async function readCopy(file, stat) {
  const cached = cache.get(file);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.data;
  let data = null;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    // Copy being written: keep the old one.
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
 * Context and cost of each session, quotas of each account, based on the status line copies
 * (`<account>/<session>.json`).
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
