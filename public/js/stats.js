import { escapeHtml, formatCost, formatTokens, slotClass } from './format.js';
import { LOCALE, t } from './i18n.js';

// Usage screen: today hour by hour, or the last 7 days day by day, in cost or in tokens. Totals first, then each
// account's share, then a stacked chart (one color per account) with a scale and a tooltip per column.

const METRICS = {
  cost: { value: (bucket) => bucket.cost ?? 0, format: (value) => formatCost(value) || t('cost', { amount: 0 }) },
  tokens: { value: (bucket) => bucket.tokens ?? 0, format: (value) => formatTokens(value) },
};
const GRIDLINES = 4;
const HOUR_LABEL_EVERY = 3;
const percent = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'always' });

/**
 * Round scale maximum and step for a chart whose highest column is `max`: 1, 2 or 5 times a power of ten.
 */
function scale(max) {
  if (!max) return { top: 1, step: 0.25 };
  const rough = max / GRIDLINES;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough);
  return { top: step * Math.ceil(max / step), step };
}

function sum(list, pick) {
  return list.reduce((total, item) => total + pick(item), 0);
}

/**
 * The columns of the chart for a period: label, then one bucket per account ({ tokens, cost }).
 */
function columnsFor(stats, accounts, period) {
  const lastDay = stats.days.length - 1;
  if (period === 'day') {
    const now = new Date();
    return Array.from({ length: 24 }, (_, hour) => ({
      label: t('stats.hour', { hour }),
      short: hour % HOUR_LABEL_EVERY === 0 ? t('stats.hour', { hour }) : '',
      current: hour === now.getHours(),
      future: hour > now.getHours(),
      buckets: accounts.map((account) => stats.accounts[account.id]?.[lastDay]?.hours[hour] ?? { tokens: 0, cost: 0 }),
    }));
  }
  return stats.days.map((day, index) => {
    const date = new Date(`${day}T12:00:00`);
    return {
      label: date.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }),
      short: date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric' }),
      current: index === lastDay,
      future: false,
      buckets: accounts.map((account) => {
        const usage = stats.accounts[account.id]?.[index];
        return { tokens: usage?.tokens ?? 0, cost: usage?.cost ?? 0 };
      }),
    };
  });
}

/**
 * Days of the period for an account: today alone, or the whole week.
 */
function daysFor(stats, accountId, period) {
  const days = stats.accounts[accountId] ?? [];
  return period === 'day' ? days.slice(-1) : days;
}

/**
 * Today against a usual day at the same time: the average, up to this hour, of the previous days that saw some use.
 */
function comparison(stats, accounts, metric) {
  const hour = new Date().getHours();
  const upToNow = (day) => sum((day?.hours ?? []).slice(0, hour + 1), METRICS[metric].value);
  const totals = stats.days.map((_, index) => sum(accounts, (account) => upToNow(stats.accounts[account.id]?.[index])));
  const today = totals.at(-1);
  const previous = totals.slice(0, -1).filter(Boolean);
  if (!previous.length || !today) return '';
  const usual = sum(previous, (value) => value) / previous.length;
  return t('stats.vsUsual', { change: percent.format(today / usual - 1) });
}

export class StatsOverlay {
  constructor(element) {
    this.element = element;
    this.metric = 'cost';
    this.period = 'day';
    this.columns = [];
    this.hovered = null;
    this.drawn = '';
    element.addEventListener('click', (event) => {
      if (event.target === element || event.target.closest('[data-close]')) return this.close();
      const choice = event.target.closest('[data-metric], [data-period]');
      if (!choice) return;
      this.metric = choice.dataset.metric ?? this.metric;
      this.period = choice.dataset.period ?? this.period;
      this.hovered = null;
      this.render(this.state);
    });
    element.addEventListener('mousemove', (event) => this.hover(event));
    element.addEventListener('mouseleave', () => this.hover(null));
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
    // The state comes every second: draw again only when something shown has changed, so the pointer keeps its column.
    const drawn = JSON.stringify([stats, accounts.map(({ id, label, slot }) => [id, label, slot]), this.period, this.metric, new Date().getHours()]);
    if (drawn === this.drawn && this.element.firstChild) return;
    this.drawn = drawn;
    const body = stats?.days ? this.body(stats, accounts) : `<p class="stats__empty">${t('stats.loading')}</p>`;
    const toggle = (kind, values) => `<div class="stats__toggle" role="group">${values.map((value) => `<button type="button" data-${kind}="${value}"
      class="${this[kind] === value ? 'is-active' : ''}">${t(`stats.${kind}.${value}`)}</button>`).join('')}</div>`;
    this.element.innerHTML = `<div class="stats__panel" role="dialog" aria-label="${t('stats.title')}">
      <header class="stats__head"><h2>${t('stats.title')}</h2>${toggle('period', ['day', 'week'])}${toggle('metric', ['cost', 'tokens'])}
        <button type="button" class="stats__close" data-close title="${t('close')}">✕</button></header>
      ${body}
    </div>`;
    if (this.hovered != null) this.showTip(this.hovered);
  }

  body(stats, accounts) {
    const { metric, period } = this;
    const format = METRICS[metric].format;
    const perAccount = accounts.map((account) => {
      const days = daysFor(stats, account.id, period);
      return {
        account,
        cost: sum(days, (day) => day.cost ?? 0),
        tokens: sum(days, (day) => day.tokens ?? 0),
        sessions: sum(days, (day) => day.sessions ?? 0),
        agents: sum(days, (day) => day.agents ?? 0),
        unpriced: sum(days, (day) => day.unpriced ?? 0),
        activeDays: days.filter((day) => day.tokens).length,
      };
    });
    const total = (key) => sum(perAccount, (row) => row[key]);
    const headline = metric === 'cost' ? formatCost(total('cost')) || t('cost', { amount: 0 }) : formatTokens(total('tokens'));
    const activeDays = Math.max(...perAccount.map((row) => row.activeDays), 0);
    const context = period === 'day' ? comparison(stats, accounts, metric)
      : activeDays ? t('stats.perDay', { value: format((metric === 'cost' ? total('cost') : total('tokens')) / activeDays) }) : '';
    const figures = [
      metric === 'cost' ? [formatTokens(total('tokens')), t('stats.total.tokens')] : [formatCost(total('cost')) || t('cost', { amount: 0 }), t('stats.total.cost')],
      [String(total('sessions')), t('stats.total.sessions')],
      [String(total('agents')), t('stats.total.agents')],
    ];
    const grand = metric === 'cost' ? total('cost') : total('tokens');
    const shares = perAccount.map((row) => {
      const value = metric === 'cost' ? row.cost : row.tokens;
      return `<li class="stats__share">
        <span class="badge badge--${slotClass(row.account.slot)}">${escapeHtml(row.account.label)}</span>
        <span class="stats__track"><i class="stats__fill stats__fill--${slotClass(row.account.slot)}" style="width:${grand ? (value / grand) * 100 : 0}%"></i></span>
        <b>${escapeHtml(format(value))}</b>
        <span class="stats__muted">${escapeHtml(`${t('stats.chats', { count: row.sessions })} · ${t('stats.agents', { count: row.agents })}`)}</span>
      </li>`;
    }).join('');
    this.columns = columnsFor(stats, accounts, period);
    const unpriced = total('unpriced');
    return `<section class="stats__summary">
        <div class="stats__headline"><b>${escapeHtml(headline)}</b><span>${escapeHtml(t(`stats.headline.${metric}`))}</span>
          ${context ? `<em>${escapeHtml(context)}</em>` : ''}</div>
        <dl class="stats__figures">${figures.map(([value, label]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      </section>
      <ul class="stats__shares">${shares}</ul>
      ${grand ? this.chart(accounts) : `<p class="stats__empty">${t('stats.empty')}</p>`}
      <p class="stats__note">${t('stats.note')}${metric === 'cost' && unpriced ? ` ${escapeHtml(t('stats.unpriced', { tokens: formatTokens(unpriced) }))}` : ''}</p>`;
  }

  chart(accounts) {
    const value = METRICS[this.metric].value;
    const heights = this.columns.map((column) => sum(column.buckets, value));
    const { top, step } = scale(Math.max(...heights));
    const lines = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
      .map((level) => `<div class="stats__gridline" style="bottom:${(level / top) * 100}%"><span>${escapeHtml(METRICS[this.metric].format(level))}</span></div>`).join('');
    const columns = this.columns.map((column, index) => {
      const segments = column.buckets.map((bucket, account) => {
        const height = (value(bucket) / top) * 100;
        return height ? `<i class="stats__segment stats__fill--${slotClass(accounts[account].slot)}" style="height:${height}%"></i>` : '';
      }).join('');
      const flags = [column.current && 'stats__column--now', column.future && 'stats__column--future'].filter(Boolean).join(' ');
      return `<div class="stats__column ${flags}" data-column="${index}"><div class="stats__stack">${segments}</div>
        <span class="stats__label">${escapeHtml(column.short)}</span></div>`;
    }).join('');
    return `<div class="stats__chart stats__chart--${this.period}">
        <div class="stats__plot">${lines}<div class="stats__columns">${columns}</div></div>
        <div class="stats__tip mc-tooltip" hidden></div>
      </div>`;
  }

  /**
   * Tooltip of the column under the pointer: its date or hour, each account's value and the total.
   */
  hover(event) {
    const column = event?.target.closest?.('[data-column]');
    this.hovered = column ? Number(column.dataset.column) : null;
    this.showTip(this.hovered);
  }

  showTip(index) {
    const tip = this.element.querySelector('.stats__tip');
    const column = index == null ? null : this.element.querySelector(`[data-column="${index}"]`);
    if (!tip) return;
    if (!column) {
      tip.hidden = true;
      return;
    }
    const data = this.columns[index];
    const accounts = this.state.accounts ?? [];
    const { value, format } = METRICS[this.metric];
    const rows = data.buckets.map((bucket, index) => `<div><i class="stats__dot stats__fill--${slotClass(accounts[index].slot)}"></i>${escapeHtml(accounts[index].label)}
      <b>${escapeHtml(format(value(bucket)))}</b></div>`).join('');
    tip.innerHTML = `<div class="mc-tooltip__title">${escapeHtml(data.label)}</div>${rows}
      <div class="stats__tip-total">${t('stats.totalLabel')} <b>${escapeHtml(format(sum(data.buckets, value)))}</b></div>`;
    tip.hidden = false;
    const chart = tip.parentElement.getBoundingClientRect();
    const box = column.getBoundingClientRect();
    const left = Math.min(box.left - chart.left + box.width + 8, chart.width - tip.offsetWidth);
    tip.style.transform = `translate(${Math.max(0, left)}px, 8px)`;
  }
}
