import { TEXTURE_ROOT } from './textures.js';
import { escapeHtml, formatCost, formatTokens, levelClass, tasksText, truncate } from './format.js';

// Petits morceaux d'interface partagés par les panneaux des pièces, le panneau de droite et le mode simple.

const ITEMS = `${TEXTURE_ROOT}item/`;
const MAX_PIPS = 12;

/**
 * Avancement des tâches : une case par tâche (finie, en cours, à faire). Au-delà de 12 tâches, une case en vaut plusieurs.
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
 * Contexte en barre d'expérience Minecraft : segmentée, de la couleur de son niveau (bleu, jaune, orange).
 */
export function xpBar(context) {
  if (context?.pct == null) return context?.tokens ? `<span class="xp xp--unknown">ctx ${formatTokens(context.tokens)}</span>` : '';
  return `<span class="xp ${levelClass(context.pct)}"><span class="xp__bar"><i style="width:${Math.min(100, context.pct)}%"></i></span><b>${context.pct} %</b></span>`;
}

export function emeraldCost(cost) {
  if (!cost) return '';
  return `<span class="emerald"><img src="${ITEMS}emerald.png" alt="">${escapeHtml(formatCost(cost))}</span>`;
}

export function itemIcon(name, className = 'item-icon') {
  return `<img class="${className}" src="${ITEMS}${name}.png" alt="">`;
}
