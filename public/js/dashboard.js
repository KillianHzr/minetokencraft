import {
  ago,
  clockTime,
  escapeHtml,
  forecastText,
  formatCost,
  formatTokens,
  gitText,
  isUrgent,
  playerActivity,
  slotClass,
  toolText,
  truncate,
} from './format.js';
import { faceImg } from './hud.js';

// Mode simple : un tableau de bord sans jeu (fond gris clair, cartes blanches arrondies, Montserrat, un accent vert
// lime, badges rectangulaires). Les états gardent la palette bleu / jaune / orange, lisible en daltonisme.
const COLUMNS = [
  { status: 'waiting', title: 'À toi de jouer', empty: 'Personne ne t\'attend' },
  { status: 'working', title: 'En cours', empty: 'Aucune session au travail' },
  { status: 'done', title: 'Terminé', empty: 'Rien de terminé récemment' },
];
const STATUS_BADGES = { waiting: 'En attente', working: 'Au travail', done: 'Terminé' };
const AGENTS_LISTED = 4;
// Paliers de compactage quand une colonne déborde : la citation, puis les agents, puis la branche et les tâches,
// puis les marges. Le contexte et le coût restent toujours ; au-delà, la colonne défile plutôt que de couper.
const DENSITIES = ['', 'compact', 'tiny', 'micro', 'nano'];

// Niveau d'une jauge qui se remplit (quota, contexte) : bleu, puis jaune, puis orange.
function level(pct) {
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'mid';
  return 'low';
}

function progress(pct, className = '') {
  return `<span class="ui-progress ui-progress--${level(pct)} ${className}"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></span>`;
}

function accountBadge(slot, label) {
  return `<span class="ui-badge ui-badge--account ui-badge--${slotClass(slot)}">${escapeHtml(label)}</span>`;
}

function quotaRow(label, quota, forecast, now) {
  if (!quota) return `<div class="ui-quota"><span class="ui-quota__label">${label}</span><span class="ui-muted">pas encore de donnée</span></div>`;
  const spent = quota.usedPct >= 100;
  const trend = forecastText(forecast, now);
  const meta = trend ? `<span class="ui-quota__meta ui-quota__meta--warn">${escapeHtml(trend)}</span>`
    : quota.resetsAt ? `<span class="ui-quota__meta">remise à zéro ${clockTime(quota.resetsAt, now)}</span>` : '';
  return `<div class="ui-quota">
      <span class="ui-quota__label">${label}</span>
      ${progress(quota.usedPct)}
      ${spent ? '<span class="ui-badge ui-badge--solid-orange">Épuisé</span>' : `<b class="ui-quota__value">${Math.round(quota.usedPct)} %</b>`}
      ${meta}
    </div>`;
}

function accountCard(account, now) {
  const usage = account.usage;
  return `<section class="ui-card ui-card--account">
      <header class="ui-card__head">
        <span class="ui-tile">${accountGlyph}</span>
        <h2 class="ui-card__title">${escapeHtml(account.label)}</h2>
        ${account.plan ? `<span class="ui-badge ui-badge--outline">${escapeHtml(account.plan)}</span>` : ''}
      </header>
      <div class="ui-quotas">
        ${usage ? quotaRow('5 heures', usage.fiveHour, account.forecast?.fiveHour, now) + quotaRow('7 jours', usage.sevenDay, account.forecast?.sevenDay, now)
          : '<p class="ui-muted">Pas encore de données de quota.</p>'}
      </div>
    </section>`;
}

function agentList(player) {
  if (!player.villagers.length) return '';
  const rows = player.villagers.slice(0, AGENTS_LISTED).map((agent) => {
    const doing = agent.status === 'working' && agent.tool ? `<span class="ui-muted"> · ${escapeHtml(truncate(toolText(agent.tool), 28))}</span>` : '';
    return `<li><i class="ui-dot ui-dot--${agent.status}"></i><span>${escapeHtml(truncate(agent.description, 48))}${doing}</span></li>`;
  });
  const more = player.villagers.length - AGENTS_LISTED;
  if (more > 0) rows.push(`<li class="ui-muted">+ ${more} agent${more > 1 ? 's' : ''}</li>`);
  return `<ul class="ui-item__agents">${rows.join('')}</ul>`;
}

function sessionItem(player, now) {
  const quote = player.status === 'working' ? player.lastPrompt : player.lastText || player.lastPrompt;
  const git = gitText(player.git);
  const urgent = isUrgent(player, now);
  const badge = player.stuck ? '<span class="ui-badge ui-badge--orange">Bloquée ?</span>'
    : `<span class="ui-badge ui-badge--${player.status}">${urgent ? 'Attend depuis longtemps' : STATUS_BADGES[player.status]}</span>`;
  const tasks = player.tasks?.total
    ? `<div class="ui-item__tasks">${progress((player.tasks.done / player.tasks.total) * 100, 'ui-progress--tasks')}
        <span>${player.tasks.done}/${player.tasks.total}${player.tasks.current ? ` · ${escapeHtml(truncate(player.tasks.current, 60))}` : ''}</span></div>` : '';
  const context = player.context?.pct != null
    ? `<span class="ui-meter" title="Contexte utilisé">${progress(player.context.pct, 'ui-progress--small')}${player.context.pct} %</span>`
    : player.context?.tokens ? `<span class="ui-meter" title="Contexte utilisé">${formatTokens(player.context.tokens)}</span>` : '';
  const cost = formatCost(player.costUSD);
  const flags = [urgent && 'ui-item--urgent', player.stuck && 'ui-item--stuck'].filter(Boolean).join(' ');
  return `<article class="ui-item ui-item--${player.status} ${flags}" data-player="${escapeHtml(player.id)}" title="Aller au terminal">
      <div class="ui-item__meta">
        ${faceImg(player.skinUrl, 'ui-avatar')}
        ${accountBadge(player.accountSlot, player.accountLabel)}
        <span class="ui-item__project">${escapeHtml(truncate(player.project, 28))}</span>
        ${git ? `<span class="ui-item__git">${escapeHtml(truncate(git, 34))}</span>` : ''}
        <span class="ui-item__time">${ago(player.lastActivityAt, now)}</span>
        <button class="ui-button" type="button" data-history="${escapeHtml(player.id)}" title="Historique">${HISTORY_GLYPH}</button>
      </div>
      <div class="ui-item__body">
        <h3 class="ui-item__title"><span class="ui-item__name">${escapeHtml(player.name)}</span>${player.kind === 'bg' ? ' <span class="ui-badge ui-badge--neutral">Tâche de fond</span>' : ''}</h3>
        <p class="ui-item__activity">${badge}<span class="ui-item__doing">${escapeHtml(truncate(playerActivity(player, now), 90))}</span>
          ${context}${cost ? `<b class="ui-item__cost">${cost}</b>` : ''}</p>
        ${tasks}
        ${quote ? `<p class="ui-item__quote">« ${escapeHtml(truncate(quote, 220))} »</p>` : ''}
      </div>
      ${agentList(player)}
    </article>`;
}

// Glyphes pleins, 24 x 24, de la couleur du texte.
const HISTORY_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1-9.7 12.4 1 1 0 1 1 1.9-.5A8 8 0 1 0 6 6.6L7.7 8.3A.6.6 0 0 1 7.3 9.3H2.6a.6.6 0 0 1-.6-.6V4a.6.6 0 0 1 1-.4l1.6 1.6A10 10 0 0 1 12 2Zm0 5a1 1 0 0 1 1 1v3.6l2.7 2.7a1 1 0 0 1-1.4 1.4l-3-3a1 1 0 0 1-.3-.7V8a1 1 0 0 1 1-1Z"/></svg>';
const accountGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 12c4.4 0 8 2.2 8 5v1.5c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5V19c0-2.8 3.6-5 8-5Z"/></svg>';
const COLUMN_GLYPHS = {
  waiting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 4.5a1.4 1.4 0 0 0-1.4 1.5l.4 5.2a1 1 0 0 0 2 0l.4-5.2A1.4 1.4 0 0 0 12 6.5Zm0 9.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/></svg>',
  working: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.5L13.5 2Z"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm4.3 6.3-5.6 5.6-2.9-2.9a1 1 0 1 0-1.4 1.4l3.6 3.6a1 1 0 0 0 1.4 0l6.3-6.3a1 1 0 1 0-1.4-1.4Z"/></svg>',
};

export class Dashboard {
  constructor(element, { onFocus, onHistory }) {
    this.element = element;
    element.addEventListener('click', (event) => {
      const history = event.target.closest('[data-history]');
      if (history) return onHistory(history.dataset.history);
      const item = event.target.closest('[data-player]');
      if (item) onFocus(item.dataset.player);
    });
    // La barre d'outils (commune aux deux modes) est posée sur l'en-tête : celui-ci prend sa hauteur.
    const toolbar = document.getElementById('toolbar');
    new ResizeObserver(() => document.documentElement.style.setProperty('--toolbar-height', `${toolbar.offsetHeight}px`)).observe(toolbar);
  }

  render(state) {
    const now = Date.now();
    const players = state.players;
    const accounts = state.accounts ?? [];
    const active = players.filter((player) => player.status !== 'sleeping');
    const columns = COLUMNS.map(({ status, title, empty }) => {
      const list = players.filter((player) => player.status === status);
      return `<section class="ui-card ui-column ui-column--${status}">
          <header class="ui-card__head">
            <span class="ui-tile ui-tile--${status}">${COLUMN_GLYPHS[status]}</span>
            <h2 class="ui-card__title">${title}</h2>
            <span class="ui-count">${list.length}</span>
          </header>
          <div class="ui-column__list">${list.length ? list.map((player) => sessionItem(player, now)).join('')
            : `<p class="ui-empty"><span class="ui-tile ui-tile--empty">${COLUMN_GLYPHS[status]}</span>${empty}</p>`}</div>
        </section>`;
    }).join('');
    const idle = players.filter((player) => player.status === 'sleeping');
    const idleList = idle.map((player) => `<li class="ui-chip" data-player="${escapeHtml(player.id)}" title="${escapeHtml(`${player.name} · ${player.project}`)}">
        ${faceImg(player.skinUrl, 'ui-avatar ui-avatar--small')}<i class="ui-dot ui-dot--${slotClass(player.accountSlot)}"></i>
        <span class="ui-chip__name">${escapeHtml(truncate(player.name, 36))}</span><span class="ui-muted">${ago(player.lastActivityAt, now)}</span></li>`).join('');
    this.element.innerHTML = `
      <header class="ui-bar">
        <span class="ui-bar__logo">M</span>
        <div><h1 class="ui-bar__title">MineTokenCraft</h1>
          <p class="ui-bar__sub">${active.length} active${active.length > 1 ? 's' : ''} · ${accounts.map((account) => escapeHtml(account.label)).join(' et ')}</p></div>
      </header>
      <div class="ui-page">
        <div class="ui-summary">${accounts.map((account) => accountCard(account, now)).join('')}</div>
        <div class="ui-columns">${columns}</div>
        ${idle.length ? `<section class="ui-card ui-idle"><header class="ui-idle__head"><h2>Inactives depuis plus d'une heure</h2><span class="ui-count">${idle.length}</span></header>
          <ul class="ui-idle__list">${idleList}</ul></section>` : ''}
      </div>`;
    this.fit();
  }

  fit() {
    const overflowing = () => [...this.element.querySelectorAll('.ui-column__list')]
      .some((list) => list.scrollHeight > list.clientHeight + 1);
    for (const density of DENSITIES) {
      this.element.dataset.density = density;
      if (!overflowing()) break;
    }
    this.fitIdle();
  }

  /**
   * Sessions inactives sur deux lignes au plus : celles qui débordent sont résumées par un « + n ».
   */
  fitIdle() {
    const list = this.element.querySelector('.ui-idle__list');
    if (!list) return;
    const items = [...list.children];
    const fits = (item) => item.offsetTop + item.offsetHeight <= list.clientHeight;
    if (items.every(fits)) return;
    const more = document.createElement('li');
    more.className = 'ui-chip ui-chip--more';
    list.append(more);
    // On retire des sessions par la fin jusqu'à ce que le « + n » tienne avec celles qui restent.
    for (let shown = items.length; shown >= 0; shown--) {
      items.forEach((item, index) => (item.hidden = index >= shown));
      more.textContent = `+ ${items.length - shown}`;
      if (fits(more) && items.slice(0, shown).every(fits)) break;
    }
  }
}
