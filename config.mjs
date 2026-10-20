import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const PORT = Number(process.env.MINETOKENCRAFT_PORT || process.env.PORT) || 4747;
// The page shows conversation excerpts: the server only listens on the local machine.
export const HOST = '127.0.0.1';

// Settings (accounts, session keys, notifications) and working data (quota history). On Windows, in the usual
// AppData folders.
const windows = process.platform === 'win32';
const configRoot = process.env.XDG_CONFIG_HOME || (windows && process.env.APPDATA) || path.join(home, '.config');
const cacheRoot = process.env.XDG_CACHE_HOME || (windows && process.env.LOCALAPPDATA) || path.join(home, '.cache');
export const CONFIG_DIR = path.join(configRoot, 'minetokencraft');
export const CACHE_DIR = path.join(cacheRoot, 'minetokencraft');
// Textures, font and skins downloaded on first launch: in the user's folder, since the install folder may be
// read-only.
export const ASSETS_DIR = path.join(CACHE_DIR, 'assets');

// Copies of the JSON that Claude Code passes to the status line (context, quotas), one per session, stored per account:
// `<account>/<session>.json`. They are dropped by scripts/statusline.mjs.
export const STATUSLINE_DIR = path.join(CACHE_DIR, 'statusline');
// Copy of a session closed for a week: we delete it.
export const STATUSLINE_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const POLL_MS = 1000;
// A session that finished longer ago than this becomes inactive: no more room, one line in the panel.
export const DORMANT_AFTER_MS = 60 * 60 * 1000;
// A busy status that nothing has refreshed since this delay is stale.
export const BUSY_STALE_MS = 30 * 60 * 1000;
// A villager that has finished stays this long with its player before leaving.
export const VILLAGER_LINGER_MS = 15 * 60 * 1000;
// A sub-agent that has written nothing since this delay is considered stopped.
export const VILLAGER_STALE_MS = 20 * 60 * 1000;

// Bytes read at the end of a transcript: enough to find the title, the last message and the current tool.
export const SESSION_TAIL_BYTES = 768 * 1024;
export const VILLAGER_TAIL_BYTES = 128 * 1024;

// A Claude that has been waiting for you longer than this goes to heightened alert.
export const WAITING_URGENT_MS = 5 * 60 * 1000;
// A working session that has written nothing since this delay may be stuck.
export const STUCK_AFTER_MS = 8 * 60 * 1000;
// Git status of a directory: recomputed at most every 10 s (big repos are slow).
export const GIT_REFRESH_MS = 10 * 1000;

// Quota forecast: trend computed over the last hour of samples.
export const FORECAST_WINDOW_MS = 60 * 60 * 1000;
export const USAGE_SAMPLE_MS = 60 * 1000;

// Real weather (Open-Meteo, no key): the configured city, otherwise the one of the machine's time zone.
export const WEATHER_REFRESH_MS = 10 * 60 * 1000;
// Accounts: the Claude Code config folders are searched again every minute.
export const ACCOUNTS_REFRESH_MS = 60 * 1000;
// Quotas read from Anthropic: every 2 minutes; after a rate-limit refusal, we back off.
export const LIMITS_REFRESH_MS = 2 * 60 * 1000;
export const LIMITS_BACKOFF_MS = 5 * 60 * 1000;
export const LIMITS_BACKOFF_MAX_MS = 60 * 60 * 1000;
