import { skinFace, TEXTURE_ROOT } from './textures.js';
import { t } from './i18n.js';
import { accountTheme, THEMES } from './themes.js';
import {
  ago,
  clockTime,
  escapeHtml,
  forecastText,
  gitText,
  isUrgent,
  formatPct,
  levelClass,
  playerActivity,
  slotClass,
  STATUS_ICONS,
  statusTitle,
  toolText,
  truncate,
} from './format.js';
import { emeraldCost, itemIcon, tasksLine, xpBar } from './widgets.js';

const HUD_SPRITES = `${TEXTURE_ROOT}gui/sprites/hud/`;
const STATUS_ORDER = ['waiting', 'working', 'done', 'sleeping'];
const CHAT_LINES = 7;
const CHAT_FADE_MS = 45000;
// Panel compaction steps, used when everything does not fit in its height.
const DENSITIES = ['', 'compact', 'tiny', 'micro', 'nano'];

const faces = new Map();

export function faceImg(skinUrl, className = 'face') {
  const src = faces.get(skinUrl);
  if (!src) {
    skinFace(skinUrl).then((url) => {
      faces.set(skinUrl, url);
      document.querySelectorAll(`img[data-skin="${CSS.escape(skinUrl)}"]`).forEach((img) => (img.src = url));
    });
  }
  return `<img class="${className}" data-skin="${escapeHtml(skinUrl)}" ${src ? `src="${src}"` : ''} alt="">`;
}

function badge(player) {
  return `<span class="badge badge--${slotClass(player.accountSlot)}">${escapeHtml(player.accountLabel)}</span>`;
}

/**
 * Minecraft gauge: 10 icons for what is left of the quota (hearts for 5 hours, drumsticks for 7 days).
 */
function quotaIcons(remainingPct, kind) {
  const [full, half, empty] = kind === 'heart'
    ? ['heart/container.png|heart/full.png', 'heart/container.png|heart/half.png', 'heart/container.png']
    : ['food_empty.png|food_full.png', 'food_empty.png|food_half.png', 'food_empty.png'];
  const icons = [];
  for (let i = 0; i < 10; i++) {
    const layers = remainingPct >= (i + 1) * 10 ? full : remainingPct >= i * 10 + 5 ? half : empty;
    icons.push(`<span class="icon">${layers.split('|').map((file) => `<img src="${HUD_SPRITES}${file}" alt="">`).join('')}</span>`);
  }
  // Minecraft fills the hunger bar from right to left.
  return `<span class="icons icons--${kind}">${(kind === 'heart' ? icons : icons.reverse()).join('')}</span>`;
}

export function quotaRow(label, quota, kind, forecast) {
  if (!quota) return `<div class="quota quota--missing"><span class="quota__label">${label}</span><span class="quota__text muted">${t('quota.none')}</span></div>`;
  const remaining = Math.max(0, 100 - quota.usedPct);
  const reset = quota.resetsAt ? ` · ↻ ${clockTime(quota.resetsAt)}` : '';
  const used = quota.usedPct >= 100 ? t('quota.spent') : formatPct(quota.usedPct);
  const trend = forecastText(forecast);
  return `<div class="quota ${levelClass(quota.usedPct)}">
    <span class="quota__label">${label}</span>${quotaIcons(remaining, kind)}
    <span class="quota__text"><b>${used}</b>${reset}</span>
  </div>${trend ? `<div class="quota__forecast">→ ${escapeHtml(trend)}</div>` : ''}`;
}

export function accountQuotas(account) {
  if (!account.usage) return `<span class="quota__text muted">${t('quota.noData')}</span>`;
  return quotaRow(t('quota.fiveHourShort'), account.usage.fiveHour, 'heart', account.forecast?.fiveHour)
    + quotaRow(t('quota.sevenDayShort'), account.usage.sevenDay, 'food', account.forecast?.sevenDay);
}

function usageSection(accounts) {
  return `<section class="usage">${accounts.map((account) => `
    <div class="account">
      <span class="badge badge--${slotClass(account.slot)}">${escapeHtml(account.label)}</span>
      ${accountQuotas(account)}
    </div>`).join('')}
  </section>`;
}

const VILLAGERS_LISTED = 5;

function villagerList(player) {
  if (!player.villagers.length) return '';
  const rows = player.villagers.slice(0, VILLAGERS_LISTED).map((villager) => {
    const doing = villager.status === 'working' && villager.tool ? ` <span class="muted">· ${escapeHtml(truncate(toolText(villager.tool), 28))}</span>` : '';
    return `<li class="villager villager--${villager.status}" data-villager="${escapeHtml(villager.id)}" title="${escapeHtml(t('session.villagerHistory'))}"><span class="status-icon">${STATUS_ICONS[villager.status]}</span> ${escapeHtml(truncate(villager.description, 34))}${doing}</li>`;
  });
  const more = player.villagers.length - VILLAGERS_LISTED;
  if (more > 0) rows.push(`<li class="muted">${t('panel.more', { count: more })}</li>`);
  return `<ul class="card__villagers">${rows.join('')}</ul>`;
}

function playerCard(player, now) {
  const quote = player.status === 'working' ? player.lastPrompt : player.lastText || player.lastPrompt;
  const where = [escapeHtml(player.project), escapeHtml(gitText(player.git)), player.kind === 'bg' ? t('session.background') : '']
    .filter(Boolean).join(' · ');
  const gauges = [xpBar(player.context), emeraldCost(player.costUSD)].filter(Boolean).join(' · ');
  const flags = [isUrgent(player, now) && 'card--urgent', player.stuck && 'card--stuck'].filter(Boolean).join(' ');
  return `<article class="card card--${player.status} ${flags}" data-player="${escapeHtml(player.id)}" title="${escapeHtml(t('session.goToTerminal'))}">
    ${faceImg(player.skinUrl)}
    <div class="card__body">
      <div class="card__title">${badge(player)} ${escapeHtml(truncate(player.name, 60))}</div>
      <div class="card__status"><span class="status-icon">${player.stuck ? '⚠' : STATUS_ICONS[player.status]}</span> ${escapeHtml(truncate(playerActivity(player, now), 70))}</div>
      ${tasksLine(player.tasks, 50)}
      <div class="card__meta"><span class="card__where">${where}</span>${where && gauges ? ' · ' : ''}<span class="card__gauges">${gauges}</span></div>
      ${quote ? `<div class="card__quote">${escapeHtml(t('quote', { text: truncate(quote, 160) }))}</div>` : ''}
      ${villagerList(player)}
    </div>
    <button class="card__history" type="button" data-history="${escapeHtml(player.id)}" title="${escapeHtml(t('session.history'))}">${itemIcon('writable_book')}</button>
  </article>`;
}

function sleeperRow(player, now) {
  return `<li class="sleeper" data-player="${escapeHtml(player.id)}" title="${escapeHtml(`${player.name} · ${player.project} · ${t('session.clickToTerminal')}`)}">${faceImg(player.skinUrl, 'face face--small')}
    <span class="sleeper__name">${badge(player)} ${escapeHtml(truncate(player.name, 34))}</span>
    <span class="sleeper__meta">${escapeHtml(player.project)} · ${ago(player.lastActivityAt, now)}</span></li>`;
}

export class Panel {
  constructor(element, { onHover, onFocus, onHistory }) {
    this.element = element;
    element.addEventListener('mouseover', (event) => onHover(event.target.closest('[data-player]')?.dataset.player ?? null));
    element.addEventListener('mouseleave', () => onHover(null));
    // Clicking a card brings its terminal back; the book opens its history, a villager line the villager's.
    element.addEventListener('click', (event) => {
      const history = event.target.closest('[data-history]');
      if (history) return onHistory(history.dataset.history);
      const villager = event.target.closest('[data-villager]');
      if (villager) return onHistory(villager.closest('[data-player]').dataset.player, villager.dataset.villager);
      const card = event.target.closest('[data-player]');
      if (card) onFocus(card.dataset.player);
    });
  }

  render(state) {
    const now = Date.now();
    const groups = Object.fromEntries(STATUS_ORDER.map((status) => [status, []]));
    for (const player of state.players) groups[player.status].push(player);
    const counts = STATUS_ORDER.map((status) => `<span class="count count--${status}" title="${statusTitle(status)}">${STATUS_ICONS[status]} ${groups[status].length}</span>`).join('');
    const sections = STATUS_ORDER.filter((status) => groups[status].length).map((status) => {
      const list = status === 'sleeping'
        ? `<ul class="sleepers">${groups[status].map((player) => sleeperRow(player, now)).join('')}</ul>`
        : groups[status].map((player) => playerCard(player, now)).join('');
      return `<section class="group group--${status}"><h2>${STATUS_ICONS[status]} ${statusTitle(status)} <span>${groups[status].length}</span></h2>${list}</section>`;
    }).join('');
    const nobodyWaiting = groups.waiting.length ? '' : `<p class="all-clear">${t('panel.allClear')}</p>`;
    this.element.innerHTML = `
      <header class="panel__head"><h1>MineTokenCraft</h1><div class="counts">${counts}</div></header>
      ${usageSection(state.accounts ?? [])}
      ${nobodyWaiting}
      ${sections}`;
    this.fit();
  }

  fit() {
    for (const density of DENSITIES) {
      this.element.dataset.density = density;
      if (this.element.scrollHeight <= this.element.clientHeight) return;
    }
  }
}

/**
 * Minecraft-style chat, at the bottom left of the scene.
 */
export class Chat {
  constructor(element) {
    this.element = element;
  }

  say(html, kind) {
    const line = document.createElement('div');
    line.className = `chat__line chat__line--${kind}`;
    line.innerHTML = html;
    this.element.append(line);
    while (this.element.children.length > CHAT_LINES) this.element.firstChild.remove();
    setTimeout(() => line.classList.add('chat__line--old'), CHAT_FADE_MS);
  }
}

/**
 * Events to announce between two snapshots of the village.
 */
export function diffEvents(previous, next) {
  if (!previous) return [];
  const events = [];
  const before = new Map(previous.players.map((player) => [player.id, player]));
  const after = new Map(next.players.map((player) => [player.id, player]));
  const who = (player) => `<b>${escapeHtml(truncate(player.name, 40))}</b>`;
  for (const player of next.players) {
    const old = before.get(player.id);
    if (!old) {
      events.push({ kind: 'join', html: t('chat.join', { who: who(player), project: escapeHtml(player.project) }) });
      continue;
    }
    if (player.status !== old.status) {
      if (player.status === 'waiting') {
        events.push({ kind: 'waiting', html: t('chat.waiting', { who: who(player), what: escapeHtml(playerActivity(player)) }), player, alert: true });
      } else if (player.status === 'done' && old.status !== 'sleeping') {
        events.push({ kind: 'done', html: t('chat.done', { who: who(player) }), player, chime: true });
      } else if (player.status === 'working' && old.status !== 'waiting') {
        events.push({ kind: 'working', html: t('chat.working', { who: who(player) }) });
      }
    }
    const oldVillagers = new Map(old.villagers.map((villager) => [villager.id, villager]));
    for (const villager of player.villagers) {
      const was = oldVillagers.get(villager.id);
      const what = escapeHtml(t('quote', { text: truncate(villager.description, 40) }));
      if (!was) events.push({ kind: 'villager', html: t('chat.villagerJoin', { who: who(player), what }) });
      else if (was.status === 'working' && villager.status === 'done') {
        events.push({ kind: 'done', html: t('chat.villagerDone', { who: who(player), what }) });
      }
    }
  }
  for (const player of previous.players) {
    if (!after.has(player.id)) events.push({ kind: 'leave', html: t('chat.leave', { who: who(player) }) });
  }
  for (const account of next.accounts ?? []) {
    const old = previous.accounts?.find((candidate) => candidate.id === account.id);
    const [before, now] = [accountTheme(old?.usage), accountTheme(account.usage)];
    if (before === now) continue;
    const label = `<b>${escapeHtml(account.label)}</b>`;
    events.push(now === 'normal'
      ? { kind: 'done', html: t('chat.overworld', { label }) }
      : { kind: `theme-${now}`, html: t(`chat.${now}`, { label, reason: escapeHtml(t(THEMES[now].reason)) }) });
  }
  return events;
}

const STORAGE_KEY = 'minetokencraft:alerts';

/**
 * Page sound (a bell when a Claude waits for you, a small ding when one finishes) and desktop notifications, sent by
 * the server even when the page is closed.
 */
export class Alerts {
  constructor(soundButton, notifyButton, { demo = false } = {}) {
    this.soundButton = soundButton;
    this.notifyButton = notifyButton;
    this.demo = demo;
    this.settings = { sound: false };
    this.desktopNotifications = null;
    try {
      this.settings.sound = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').sound === true;
    } catch {
      // Storage unavailable: default settings.
    }
    soundButton.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      if (this.settings.sound) this.play('chime');
      this.save();
    });
    notifyButton.addEventListener('click', () => this.setDesktopNotifications(!this.desktopNotifications));
    if (!demo) {
      fetch('api/settings').then((response) => response.json()).then(({ notifications, notificationsSupported }) => {
        this.desktopNotifications = notifications;
        // No desktop notifications on this machine (Windows, Linux without notify-send): no button.
        this.notifyButton.hidden = notificationsSupported === false;
        this.refreshButtons();
      }).catch(() => {});
    }
    this.refreshButtons();
  }

  async setDesktopNotifications(enabled) {
    if (this.demo) return;
    const response = await fetch('api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: enabled }),
    });
    this.desktopNotifications = (await response.json()).notifications;
    this.refreshButtons();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Too bad, the setting will not survive a reload.
    }
    this.refreshButtons();
  }

  refreshButtons() {
    this.soundButton.textContent = t('toolbar.sound', { state: t(this.settings.sound ? 'toolbar.on' : 'toolbar.off') });
    const desktop = this.desktopNotifications == null ? '…' : t(this.desktopNotifications ? 'toolbar.on' : 'toolbar.off');
    this.notifyButton.textContent = t('toolbar.notifications', { state: this.demo ? t('toolbar.offDemo') : desktop });
  }

  play(kind) {
    if (!this.settings.sound) return;
    this.audio ??= new AudioContext();
    const notes = kind === 'bell' ? [[1046, 0], [1318, 0.18], [1046, 0.5], [1318, 0.68]] : [[1568, 0], [2093, 0.09]];
    for (const [frequency, delay] of notes) {
      const start = this.audio.currentTime + delay;
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = kind === 'bell' ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'bell' ? 0.9 : 0.35));
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 1);
    }
  }

  /**
   * Crack of the lead on a villager: a short burst of noise, sharp and fading fast.
   */
  crack() {
    if (!this.settings.sound) return;
    this.audio ??= new AudioContext();
    const { sampleRate } = this.audio;
    const buffer = this.audio.createBuffer(1, Math.round(sampleRate * 0.12), sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 4;
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    const filter = this.audio.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = this.audio.createGain();
    gain.gain.value = 0.5;
    source.connect(filter).connect(gain).connect(this.audio.destination);
    source.start();
  }

  announce(events) {
    if (events.some((event) => event.alert)) this.play('bell');
    else if (events.some((event) => event.chime)) this.play('chime');
  }

  /**
   * Reminder for a Claude that has been waiting for a long time: the bell rings again.
   */
  remind(players) {
    if (players.some((player) => isUrgent(player))) this.play('bell');
  }
}
