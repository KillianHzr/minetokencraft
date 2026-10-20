import { LOCALE, t } from './i18n.js';

export const STATUS_ICONS = { waiting: '!', working: '⚒', done: '✔', sleeping: 'z', leaving: '→' };
// A Claude waiting for you longer than this gets the stronger alert (same threshold as the server).
export const WAITING_URGENT_MS = 5 * 60 * 1000;

export function statusTitle(status) {
  return t(`status.${status}`);
}

// What a waiting Claude expects from you, by the reason Claude Code gives.
const WAITING_KEYS = {
  'input needed': 'waiting.input',
  'dialog open': 'waiting.dialog',
  'sandbox request': 'waiting.sandbox',
  'goal proposal': 'waiting.goal',
};

const oneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function truncate(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function ago(timestamp, now = Date.now()) {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  return t('time.days', { count: Math.floor(hours / 24) });
}

export function clockTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  if (timestamp - now < 20 * 60 * 60 * 1000) return time;
  return `${date.toLocaleDateString(LOCALE, { weekday: 'short' })} ${time}`;
}

export function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1e6) return `${oneDecimal.format(tokens / 1e6)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

export function formatCost(cost) {
  if (!cost) return '';
  return t('cost', { amount: cost < 10 ? twoDecimals.format(cost) : Math.round(cost).toLocaleString(LOCALE) });
}

export function formatPct(pct) {
  return t('percent', { value: Math.round(pct) });
}

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted']);

/**
 * What a tool works on (file, command, search…). The server words most of it; the task tools are worded here.
 */
export function toolDetail(tool) {
  if (tool.name === 'TodoWrite') return t('tool.todo');
  if (tool.name === 'TaskUpdate' && tool.taskId) {
    if (!tool.taskStatus) return t('tool.task', { id: tool.taskId });
    const status = TASK_STATUSES.has(tool.taskStatus) ? t(`task.${tool.taskStatus}`) : tool.taskStatus;
    return t('tool.taskStatus', { id: tool.taskId, status });
  }
  return tool.label ?? '';
}

export function toolText(tool) {
  if (!tool) return '';
  const name = tool.name.startsWith('mcp__') ? tool.name.split('__')[1] : tool.name;
  const label = toolDetail(tool);
  return label ? `${name} · ${label}` : name;
}

export function workingVillagers(player) {
  return player.villagers.filter((villager) => villager.status === 'working').length;
}

export function isUrgent(player, now = Date.now()) {
  return player.status === 'waiting' && player.waitingSince != null && now - player.waitingSince > WAITING_URGENT_MS;
}

/**
 * What the player is doing, in one short line (nametag, panel, tooltip).
 */
export function playerActivity(player, now = Date.now()) {
  switch (player.status) {
    case 'waiting': {
      const what = WAITING_KEYS[player.waitingFor] ? t(WAITING_KEYS[player.waitingFor]) : player.waitingFor || t('waiting.input');
      return player.waitingSince ? t('activity.waitingSince', { what, since: ago(player.waitingSince, now) }) : what;
    }
    case 'leaving':
      return t('activity.leaving');
    case 'working': {
      if (player.stuck) {
        const idle = t('activity.stuck', { since: ago(player.lastActivityAt, now) });
        return player.tool ? `${idle} · ${toolText(player.tool)}` : idle;
      }
      if (player.tool) return toolText(player.tool);
      if (player.thinking) return t('activity.thinking');
      const helpers = workingVillagers(player);
      return helpers ? t('activity.helpers', { count: helpers }) : t('activity.working');
    }
    case 'done':
      return t('activity.done', { since: ago(player.lastActivityAt, now) });
    default:
      return ago(player.lastActivityAt, now);
  }
}

// Account colors and wing styles: four sets, given out in account order, then it starts over.
export const ACCOUNT_SLOTS = 4;

export function slotClass(slot) {
  return `slot-${(slot ?? 0) % ACCOUNT_SLOTS}`;
}

/**
 * Fill level in blue, yellow and orange, like the status line (readable with color blindness).
 */
export function levelClass(pct) {
  if (pct >= 80) return 'level--high';
  if (pct >= 50) return 'level--mid';
  return 'level--low';
}

/**
 * Git branch and folder state, as in the status line: ⎇ branch ✚ changed ? untracked ↑ ahead.
 */
export function gitText(git) {
  if (!git?.branch) return '';
  const marks = [
    git.conflicts && `✖${git.conflicts}`,
    git.changed && `✚${git.changed}`,
    git.untracked && `?${git.untracked}`,
    git.ahead && `↑${git.ahead}`,
    git.behind && `↓${git.behind}`,
  ].filter(Boolean);
  return `⎇ ${git.branch}${marks.length ? ` ${marks.join(' ')}` : ''}`;
}

/**
 * Quota forecast: when it runs out if usage keeps the pace of the last hour.
 */
export function forecastText(forecast, now = Date.now()) {
  if (!forecast?.eta) return '';
  return t('forecast', { time: clockTime(forecast.eta, now) });
}

/**
 * Progress of a task list in one line: 3/7 and the current task.
 */
export function tasksText(tasks) {
  if (!tasks?.total) return '';
  return `${tasks.done}/${tasks.total}${tasks.current ? ` · ${tasks.current}` : ''}`;
}
