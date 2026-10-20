import { TEXTURE_ROOT } from './textures.js';
import { escapeHtml, formatCost, formatPct, formatTokens, levelClass, tasksText, truncate } from './format.js';

// Small pieces of interface shared by the room tooltip, the side panel and simple mode.

const ITEMS = `${TEXTURE_ROOT}item/`;
const MAX_PIPS = 12;

/**
 * Task progress: one pip per task (done, current, to do). Past 12 tasks, one pip stands for several.
 */
export function taskPips(tasks) {
  if (!tasks?.total) return '';
  const shown = Math.min(tasks.total, MAX_PIPS);
  const scale = tasks.total / shown;
  const done = Math.round(tasks.done / scale);
  const current = tasks.current && done < shown ? 1 : 0;
  const pips = Array.from({ length: shown }, (_, index) => {
    const state = index < done ? 'done' : index < done + current ? 'current' : 'todo';
    return `<i class="pip pip--${state}"></i>`;
  });
  return `<span class="pips">${pips.join('')}</span>`;
}

export function tasksLine(tasks, max = 60) {
  if (!tasks?.total) return '';
  return `<div class="tasks">${taskPips(tasks)}<span class="tasks__text">${escapeHtml(truncate(tasksText(tasks), max))}</span></div>`;
}

/**
 * Context as a Minecraft experience bar: segmented, in the color of its level (blue, yellow, orange).
 */
export function xpBar(context) {
  if (context?.pct == null) return context?.tokens ? `<span class="xp xp--unknown">ctx ${formatTokens(context.tokens)}</span>` : '';
  return `<span class="xp ${levelClass(context.pct)}"><span class="xp__bar"><i style="width:${Math.min(100, context.pct)}%"></i></span><b>${formatPct(context.pct)}</b></span>`;
}

export function emeraldCost(cost) {
  if (!cost) return '';
  return `<span class="emerald"><img src="${ITEMS}emerald.png" alt="">${escapeHtml(formatCost(cost))}</span>`;
}

export function itemIcon(name, className = 'item-icon') {
  return `<img class="${className}" src="${ITEMS}${name}.png" alt="">`;
}
