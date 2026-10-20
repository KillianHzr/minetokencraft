import en from './locales/en.js';
import fr from './locales/fr.js';

// Interface language: English by default, French when the browser asks for it, or the choice saved in the toolbar.
// Strings live in ./locales, one file per language with the same keys (checked by `npm run check`). A value is a
// string with {placeholders}, or an object of plural forms ({ one, other }) picked from `count`.

export const LANGUAGES = {
  en: { name: 'English', locale: 'en-US', strings: en },
  fr: { name: 'Français', locale: 'fr-FR', strings: fr },
};
const STORAGE_KEY = 'minetokencraft:language';

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES[saved]) return saved;
  } catch {
    // No storage: follow the browser.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag ?? '').slice(0, 2).toLowerCase();
    if (LANGUAGES[base]) return base;
  }
  return 'en';
}

export const LANGUAGE = detect();
export const LOCALE = LANGUAGES[LANGUAGE].locale;
const strings = LANGUAGES[LANGUAGE].strings;
const plurals = new Intl.PluralRules(LOCALE);

/**
 * Text for a key in the page language, with its placeholders filled in. Returns plain text: escape it before
 * putting it in HTML, unless every value passed in is already escaped HTML.
 */
export function t(key, values = {}) {
  let text = strings[key] ?? en[key] ?? key;
  if (typeof text === 'object') text = text[plurals.select(values.count ?? 0)] ?? text.other;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

/**
 * Saves the language and reloads the page, which is simpler than re-rendering every piece of text in place.
 */
export function setLanguage(language) {
  if (!LANGUAGES[language] || language === LANGUAGE) return;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice will not survive the reload.
  }
  window.location.reload();
}

/**
 * Fills the static text of the page: `data-i18n` for the content, `data-i18n-title` for the tooltip.
 */
export function translatePage(root = document) {
  document.documentElement.lang = LANGUAGE;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
}
