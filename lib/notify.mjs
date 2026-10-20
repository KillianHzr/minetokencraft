import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSettings } from './settings.mjs';
import { translator } from './i18n.mjs';

// macOS notifications sent by the server: they arrive even when the page is not open. Off by default; the
// notifications button of the toolbar turns them on.

const run = promisify(execFile);
const SOUNDS = { waiting: 'Glass', done: 'Pop', quota: 'Basso', stuck: 'Funk' };
// Arguments go through argv: no session text is ever read as AppleScript code.
const NOTIFY_SCRIPT = [
  'on run argv',
  'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv) sound name (item 4 of argv)',
  'end run',
];

async function notify(kind, title, subtitle, message) {
  if (process.platform !== 'darwin') return;
  try {
    await run('osascript', [...NOTIFY_SCRIPT.flatMap((line) => ['-e', line]), message, title, subtitle, SOUNDS[kind]]);
  } catch (error) {
    console.error('cannot send notification:', error.message);
  }
}

const shortName = (player) => (player.name.length > 60 ? `${player.name.slice(0, 59)}…` : player.name);

/**
 * Compares two snapshots of the village and notifies what needs your attention.
 */
export async function notifyChanges(previous, next) {
  if (!previous || !(await getSettings()).notifications) return;
  const t = await translator();
  const before = new Map(previous.players.map((player) => [player.id, player]));
  for (const player of next.players) {
    const old = before.get(player.id);
    if (!old) continue;
    const where = `${player.accountLabel} · ${player.project}`;
    if (player.status === 'waiting' && old.status !== 'waiting') {
      await notify('waiting', t('notify.waiting'), where, shortName(player));
    } else if (player.status === 'done' && old.status === 'working') {
      await notify('done', t('notify.done'), where, shortName(player));
    } else if (player.stuck && !old.stuck) {
      await notify('stuck', t('notify.stuck'), where, t('notify.stuckText', { name: shortName(player) }));
    }
  }
  for (const account of next.accounts) {
    const old = previous.accounts.find((candidate) => candidate.id === account.id);
    for (const quota of ['fiveHour', 'sevenDay']) {
      const wasOut = (old?.usage?.[quota]?.usedPct ?? 0) >= 100;
      const isOut = (account.usage?.[quota]?.usedPct ?? 0) >= 100;
      if (isOut && !wasOut) await notify('quota', t(`notify.${quota}`), account.label, t('notify.quotaText'));
    }
  }
}
