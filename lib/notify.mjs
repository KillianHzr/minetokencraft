import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSettings } from './settings.mjs';

// Notifications macOS envoyées par le serveur : elles arrivent même quand la page n'est pas ouverte. Coupées par
// défaut ; on les allume avec le bouton « Notifs Mac ».

const run = promisify(execFile);
const SOUNDS = { waiting: 'Glass', done: 'Pop', quota: 'Basso', stuck: 'Funk' };
// Les arguments passent par argv : aucun texte de session n'est interprété comme du code AppleScript.
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
    console.error('notification impossible :', error.message);
  }
}

const shortName = (player) => (player.name.length > 60 ? `${player.name.slice(0, 59)}…` : player.name);

/**
 * Compare deux photographies du village et notifie ce qui demande ton attention.
 */
export async function notifyChanges(previous, next) {
  if (!previous || !(await getSettings()).notifications) return;
  const before = new Map(previous.players.map((player) => [player.id, player]));
  for (const player of next.players) {
    const old = before.get(player.id);
    if (!old) continue;
    const where = `${player.accountLabel} · ${player.project}`;
    if (player.status === 'waiting' && old.status !== 'waiting') {
      await notify('waiting', 'Un Claude t\'attend', where, shortName(player));
    } else if (player.status === 'done' && old.status === 'working') {
      await notify('done', 'Un Claude a fini', where, shortName(player));
    } else if (player.stuck && !old.stuck) {
      await notify('stuck', 'Un Claude semble bloqué', where, `${shortName(player)} : rien depuis plusieurs minutes`);
    }
  }
  for (const account of next.accounts) {
    const old = previous.accounts.find((candidate) => candidate.id === account.id);
    for (const [quota, label] of [['fiveHour', '5 h'], ['sevenDay', 'de la semaine']]) {
      const wasOut = (old?.usage?.[quota]?.usedPct ?? 0) >= 100;
      const isOut = (account.usage?.[quota]?.usedPct ?? 0) >= 100;
      if (isOut && !wasOut) await notify('quota', `Quota ${label} épuisé`, account.label, 'Les sessions de ce compte sont à l\'arrêt jusqu\'à la remise à zéro.');
    }
  }
}
