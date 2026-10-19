import { clockTime } from './format.js';

// Un compte à court de quota voit toute son aile changer de dimension : le Nether quand la fenêtre de 5 h
// est épuisée, l'End quand c'est la semaine (plus grave, elle l'emporte).
const LIMIT_PCT = 100;

export const THEMES = {
  normal: { label: null },
  nether: { label: 'Nether', reason: 'quota 5 h épuisé', quota: 'fiveHour', arrival: 'descend dans le Nether' },
  end: { label: 'End', reason: 'quota de la semaine épuisé', quota: 'sevenDay', arrival: 'part dans l\'End' },
};

export function accountTheme(usage) {
  if ((usage?.sevenDay?.usedPct ?? 0) >= LIMIT_PCT) return 'end';
  if ((usage?.fiveHour?.usedPct ?? 0) >= LIMIT_PCT) return 'nether';
  return 'normal';
}

/**
 * Explication courte du thème d'une aile, avec l'heure à laquelle le quota revient.
 */
export function themeNotice(theme, usage) {
  const { reason, quota } = THEMES[theme];
  if (!reason) return null;
  const resetsAt = usage?.[quota]?.resetsAt;
  return resetsAt ? `${reason} · retour ${clockTime(resetsAt)}` : reason;
}
