import { TEXTURE_ROOT } from './textures.js';
import { escapeHtml, formatCost, formatTokens, slotClass } from './format.js';
import { LOCALE, t } from './i18n.js';
import { itemIcon } from './widgets.js';

// "Today" screen: per account, an inventory (tokens, cost, chats, agents) and an hour by hour histogram made of block
// columns, one block per account.

// Block columns in the color of each account, in their order.
const BAR_BLOCKS = ['lapis_block', 'gold_block', 'purpur_block', 'emerald_block'];
const HOUR_LABEL_EVERY = 3;
const METRICS = {
  tokens: { label: 'stats.tokensPerHour', value: (hour) => hour.tokens, format: formatTokens },
  cost: { label: 'stats.costPerHour', value: (hour) => hour.cost ?? 0, format: (cost) => `≈ ${formatCost(cost) || t('cost', { amount: 0 })}` },
};

function slot(icon, value, label) {
  return `<div class="slot" title="${escapeHtml(label)}">${itemIcon(icon, 'slot__icon')}<span class="slot__count">${escapeHtml(value)}</span>
    <span class="slot__label">${escapeHtml(label)}</span></div>`;
}

function chart(stats, accounts, metric, now) {
  const currentHour = new Date(now).getHours();
  const max = Math.max(1, ...accounts.flatMap((account) => stats.accounts[account.id]?.hours.map(METRICS[metric].value) ?? [0]));
  const columns = Array.from({ length: 24 }, (_, hour) => {
    const bars = accounts.map((account) => {
      const value = METRICS[metric].value(stats.accounts[account.id]?.hours[hour] ?? { tokens: 0, cost: 0 });
      const height = Math.round((value / max) * 100);
      return `<i class="bar bar--${slotClass(account.slot)}" style="height:${height}%;--block:url('${TEXTURE_ROOT}block/${BAR_BLOCKS[(account.slot ?? 0) % BAR_BLOCKS.length]}.png')"
        title="${escapeHtml(t('stats.barTitle', { account: account.label, hour, value: METRICS[metric].format(value) }))}"></i>`;
    }).join('');
    const label = hour % HOUR_LABEL_EVERY === 0 ? `<span class="hour__label">${t('stats.hour', { hour })}</span>` : '';
    return `<div class="hour${hour === currentHour ? ' hour--now' : ''}${hour > currentHour ? ' hour--future' : ''}"><div class="hour__bars">${bars}</div>${label}</div>`;
  }).join('');
  return `<div class="chart">${columns}</div>`;
}

export class StatsOverlay {
  constructor(element) {
    this.element = element;
    this.metric = 'cost';
    element.addEventListener('click', (event) => {
      if (event.target === element || event.target.closest('[data-close]')) this.close();
      const metric = event.target.closest('[data-metric]')?.dataset.metric;
      if (metric) {
        this.metric = metric;
        this.render(this.state);
      }
    });
    document.addEventListener('keydown', (event) => event.key === 'Escape' && this.close());
  }

  get open() {
    return !this.element.hidden;
  }

  toggle(state) {
    if (this.open) this.close();
    else {
      this.element.hidden = false;
      this.render(state);
    }
  }

  close() {
    this.element.hidden = true;
  }

  render(state) {
    this.state = state;
    if (!this.open || !state) return;
    const stats = state.stats;
    const accounts = state.accounts ?? [];
    const now = Date.now();
    const body = !stats ? `<p class="stats__empty">${t('stats.loading')}</p>` : `
      <div class="stats__accounts">${accounts.map((account) => {
        const day = stats.accounts[account.id] ?? {};
        return `<div class="stats__account"><span class="badge badge--${slotClass(account.slot)}">${escapeHtml(account.label)}</span>
          <div class="slots">
            ${slot('diamond', formatTokens(day.tokens ?? 0), t('stats.tokens'))}
            ${slot('emerald', day.cost == null ? '?' : `≈ ${formatCost(day.cost) || t('cost', { amount: 0 })}`, t('stats.cost'))}
            ${slot('compass_00', String(day.sessions ?? 0), t('stats.sessions'))}
            ${slot('bell', String(day.agents ?? 0), t('stats.agents'))}
          </div></div>`;
      }).join('')}</div>
      <div class="stats__tabs">${Object.entries(METRICS).map(([key, { label }]) => `<button type="button" data-metric="${key}" class="${key === this.metric ? 'is-active' : ''}">${t(label)}</button>`).join('')}</div>
      ${chart(stats, accounts, this.metric, now)}
      <p class="stats__note">${t('stats.note')}</p>`;
    this.element.innerHTML = `<div class="stats__panel">
      <header class="stats__head">${itemIcon('clock_00', 'stats__clock')}<h2>${t('stats.title', { date: new Date(now).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }) })}</h2>
        <button type="button" data-close title="${t('close')}">✕</button></header>
      ${body}
    </div>`;
  }
}
