import { getSettings } from './settings.mjs';
import en from './locales/en.mjs';
import fr from './locales/fr.mjs';

// Language of what the server says itself (macOS notifications, command line): the one chosen in the page, else the
// system language, else English. The page has its own strings, in public/js/locales.

const STRINGS = { en, fr };

function systemLanguage() {
  const tags = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG, Intl.DateTimeFormat().resolvedOptions().locale];
  for (const tag of tags) {
    const base = String(tag ?? '').slice(0, 2).toLowerCase();
    if (STRINGS[base]) return base;
  }
  return 'en';
}

export async function serverLanguage() {
  const { language } = await getSettings();
  return STRINGS[language] ? language : systemLanguage();
}

/**
 * Translator for the current language: `const t = await translator()`, then `t(key, values)`.
 */
export async function translator() {
  const language = await serverLanguage();
  return (key, values = {}) => (STRINGS[language][key] ?? en[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}
