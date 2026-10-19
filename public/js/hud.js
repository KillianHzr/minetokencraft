import { skinFace, TEXTURE_ROOT } from './textures.js';
import { accountTheme, THEMES } from './themes.js';
import {
  ago,
  clockTime,
  escapeHtml,
  forecastText,
  gitText,
  isUrgent,
  levelClass,
  playerActivity,
  slotClass,
  STATUS_ICONS,
  STATUS_TITLES,
  toolText,
  truncate,
} from './format.js';
import { emeraldCost, itemIcon, tasksLine, xpBar } from './widgets.js';

const HUD_SPRITES = `${TEXTURE_ROOT}gui/sprites/hud/`;
const STATUS_ORDER = ['waiting', 'working', 'done', 'sleeping'];
const CHAT_LINES = 7;
const CHAT_FADE_MS = 45000;
// Paliers de compactage du panneau quand tout ne tient pas en hauteur.
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
 * Jauge Minecraft : 10 icônes pour ce qui reste du quota (cœurs pour 5 h, cuisses pour 7 j).
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
  // Minecraft remplit la barre de faim de droite à gauche.
  return `<span class="icons icons--${kind}">${(kind === 'heart' ? icons : icons.reverse()).join('')}</span>`;
}

export function quotaRow(label, quota, kind, forecast) {
  if (!quota) return `<div class="quota quota--missing"><span class="quota__label">${label}</span><span class="quota__text muted">pas de quota sur ce compte</span></div>`;
  const remaining = Math.max(0, 100 - quota.usedPct);
  const reset = quota.resetsAt ? ` · ↻ ${clockTime(quota.resetsAt)}` : '';
  const used = quota.usedPct >= 100 ? 'épuisé' : `${Math.round(quota.usedPct)} %`;
  const trend = forecastText(forecast);
  return `<div class="quota ${levelClass(quota.usedPct)}">
    <span class="quota__label">${label}</span>${quotaIcons(remaining, kind)}
    <span class="quota__text"><b>${used}</b>${reset}</span>
  </div>${trend ? `<div class="quota__forecast">→ ${escapeHtml(trend)}</div>` : ''}`;
}

export function accountQuotas(account) {
  if (!account.usage) return '<span class="quota__text muted">pas encore de données</span>';
  return quotaRow('5 h', account.usage.fiveHour, 'heart', account.forecast?.fiveHour)
    + quotaRow('7 j', account.usage.sevenDay, 'food', account.forecast?.sevenDay);
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
    return `<li class="villager villager--${villager.status}"><span class="status-icon">${STATUS_ICONS[villager.status]}</span> ${escapeHtml(truncate(villager.description, 34))}${doing}</li>`;
  });
  const more = player.villagers.length - VILLAGERS_LISTED;
  if (more > 0) rows.push(`<li class="muted">+ ${more} autre${more > 1 ? 's' : ''}</li>`);
  return `<ul class="card__villagers">${rows.join('')}</ul>`;
}

function playerCard(player, now) {
  const quote = player.status === 'working' ? player.lastPrompt : player.lastText || player.lastPrompt;
  const where = [escapeHtml(player.project), escapeHtml(gitText(player.git)), player.kind === 'bg' ? 'tâche de fond' : '']
    .filter(Boolean).join(' · ');
  const gauges = [xpBar(player.context), emeraldCost(player.costUSD)].filter(Boolean).join(' · ');
  const flags = [isUrgent(player, now) && 'card--urgent', player.stuck && 'card--stuck'].filter(Boolean).join(' ');
  return `<article class="card card--${player.status} ${flags}" data-player="${escapeHtml(player.id)}" title="Aller au terminal">
    ${faceImg(player.skinUrl)}
    <div class="card__body">
      <div class="card__title">${badge(player)} ${escapeHtml(truncate(player.name, 60))}</div>
      <div class="card__status"><span class="status-icon">${player.stuck ? '⚠' : STATUS_ICONS[player.status]}</span> ${escapeHtml(truncate(playerActivity(player, now), 70))}</div>
      ${tasksLine(player.tasks, 50)}
      <div class="card__meta"><span class="card__where">${where}</span>${where && gauges ? ' · ' : ''}<span class="card__gauges">${gauges}</span></div>
      ${quote ? `<div class="card__quote">« ${escapeHtml(truncate(quote, 160))} »</div>` : ''}
      ${villagerList(player)}
    </div>
    <button class="card__history" type="button" data-history="${escapeHtml(player.id)}" title="Historique">${itemIcon('writable_book')}</button>
  </article>`;
}

function sleeperRow(player, now) {
  return `<li class="sleeper" data-player="${escapeHtml(player.id)}" title="${escapeHtml(`${player.name} · ${player.project} · clic pour aller au terminal`)}">${faceImg(player.skinUrl, 'face face--small')}
    <span class="sleeper__name">${badge(player)} ${escapeHtml(truncate(player.name, 34))}</span>
    <span class="sleeper__meta">${escapeHtml(player.project)} · ${ago(player.lastActivityAt, now)}</span></li>`;
}

export class Panel {
  constructor(element, { onHover, onFocus, onHistory }) {
    this.element = element;
    element.addEventListener('mouseover', (event) => onHover(event.target.closest('[data-player]')?.dataset.player ?? null));
    element.addEventListener('mouseleave', () => onHover(null));
    // Un clic sur une carte ramène son terminal ; le livre ouvre son historique.
    element.addEventListener('click', (event) => {
      const history = event.target.closest('[data-history]');
      if (history) return onHistory(history.dataset.history);
      const card = event.target.closest('[data-player]');
      if (card) onFocus(card.dataset.player);
    });
  }

  render(state) {
    const now = Date.now();
    const groups = Object.fromEntries(STATUS_ORDER.map((status) => [status, []]));
    for (const player of state.players) groups[player.status].push(player);
    const counts = STATUS_ORDER.map((status) => `<span class="count count--${status}" title="${STATUS_TITLES[status]}">${STATUS_ICONS[status]} ${groups[status].length}</span>`).join('');
    const sections = STATUS_ORDER.filter((status) => groups[status].length).map((status) => {
      const list = status === 'sleeping'
        ? `<ul class="sleepers">${groups[status].map((player) => sleeperRow(player, now)).join('')}</ul>`
        : groups[status].map((player) => playerCard(player, now)).join('');
      return `<section class="group group--${status}"><h2>${STATUS_ICONS[status]} ${STATUS_TITLES[status]} <span>${groups[status].length}</span></h2>${list}</section>`;
    }).join('');
    const nobodyWaiting = groups.waiting.length ? '' : '<p class="all-clear">Personne ne t\'attend.</p>';
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
 * Fil de discussion façon Minecraft, en bas à gauche de la scène.
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
 * Événements à annoncer entre deux photographies du village.
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
      events.push({ kind: 'join', html: `${who(player)} a rejoint le village (${escapeHtml(player.project)})` });
      continue;
    }
    if (player.status !== old.status) {
      if (player.status === 'waiting') {
        events.push({ kind: 'waiting', html: `${who(player)} t'attend : ${escapeHtml(playerActivity(player))}`, player, alert: true });
      } else if (player.status === 'done' && old.status !== 'sleeping') {
        events.push({ kind: 'done', html: `${who(player)} a fini`, player, chime: true });
      } else if (player.status === 'working' && old.status !== 'waiting') {
        events.push({ kind: 'working', html: `${who(player)} se remet au travail` });
      }
    }
    const oldVillagers = new Map(old.villagers.map((villager) => [villager.id, villager]));
    for (const villager of player.villagers) {
      const was = oldVillagers.get(villager.id);
      const what = `« ${escapeHtml(truncate(villager.description, 40))} »`;
      if (!was) events.push({ kind: 'villager', html: `${who(player)} recrute un villageois : ${what}` });
      else if (was.status === 'working' && villager.status === 'done') {
        events.push({ kind: 'done', html: `Le villageois ${what} de ${who(player)} a fini` });
      }
    }
  }
  for (const player of previous.players) {
    if (!after.has(player.id)) events.push({ kind: 'leave', html: `${who(player)} a quitté le village` });
  }
  for (const account of next.accounts ?? []) {
    const old = previous.accounts?.find((candidate) => candidate.id === account.id);
    const [before, now] = [accountTheme(old?.usage), accountTheme(account.usage)];
    if (before === now) continue;
    const label = `<b>${escapeHtml(account.label)}</b>`;
    events.push(now === 'normal'
      ? { kind: 'done', html: `${label} revient dans l'Overworld : son quota est rechargé` }
      : { kind: `theme-${now}`, html: `${label} ${THEMES[now].arrival} : ${THEMES[now].reason}` });
  }
  return events;
}

const STORAGE_KEY = 'minetokencraft:alerts';

/**
 * Son de la page (cloche quand on t'attend, petit ding quand un Claude finit) et notifications macOS,
 * envoyées par le serveur même page fermée.
 */
export class Alerts {
  constructor(soundButton, notifyButton, { demo = false } = {}) {
    this.soundButton = soundButton;
    this.notifyButton = notifyButton;
    this.demo = demo;
    this.settings = { sound: false };
    this.macNotifications = null;
    try {
      this.settings.sound = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').sound === true;
    } catch {
      // Stockage indisponible : réglages par défaut.
    }
    soundButton.addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      if (this.settings.sound) this.play('chime');
      this.save();
    });
    notifyButton.addEventListener('click', () => this.setMacNotifications(!this.macNotifications));
    if (!demo) {
      fetch('api/settings').then((response) => response.json()).then(({ notifications }) => {
        this.macNotifications = notifications;
        this.refreshButtons();
      }).catch(() => {});
    }
    this.refreshButtons();
  }

  async setMacNotifications(enabled) {
    if (this.demo) return;
    const response = await fetch('api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: enabled }),
    });
    this.macNotifications = (await response.json()).notifications;
    this.refreshButtons();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Tant pis, le réglage ne survivra pas au rechargement.
    }
    this.refreshButtons();
  }

  refreshButtons() {
    this.soundButton.textContent = `Son : ${this.settings.sound ? 'oui' : 'non'}`;
    const mac = this.macNotifications == null ? '…' : this.macNotifications ? 'oui' : 'non';
    this.notifyButton.textContent = `Notifs Mac : ${this.demo ? 'non (test)' : mac}`;
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

  announce(events) {
    if (events.some((event) => event.alert)) this.play('bell');
    else if (events.some((event) => event.chime)) this.play('chime');
  }

  /**
   * Rappel pour un Claude qui t'attend depuis longtemps : la cloche sonne de nouveau.
   */
  remind(players) {
    if (players.some((player) => isUrgent(player))) this.play('bell');
  }
}
