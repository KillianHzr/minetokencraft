import { clockTime } from './format.js';
import { t } from './i18n.js';

// An account out of quota sees its whole wing change dimension: the Nether when the 5-hour window is spent, the End
// when the week is (worse, it wins).
const LIMIT_PCT = 100;

export const THEMES = {
  normal: { label: null },
  nether: { label: 'Nether', reason: 'theme.nether.reason', quota: 'fiveHour' },
  end: { label: 'End', reason: 'theme.end.reason', quota: 'sevenDay' },
};

export function accountTheme(usage) {
  if ((usage?.sevenDay?.usedPct ?? 0) >= LIMIT_PCT) return 'end';
  if ((usage?.fiveHour?.usedPct ?? 0) >= LIMIT_PCT) return 'nether';
  return 'normal';
}

/**
 * Short explanation of a wing's theme, with the time its quota comes back.
 */
export function themeNotice(theme, usage) {
  const { reason, quota } = THEMES[theme];
  if (!reason) return null;
  const resetsAt = usage?.[quota]?.resetsAt;
  return resetsAt ? t('theme.back', { reason: t(reason), time: clockTime(resetsAt) }) : t(reason);
}
