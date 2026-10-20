import { ago, escapeHtml, toolDetail, toolText } from './format.js';
import { t } from './i18n.js';
import { itemIcon } from './widgets.js';
import { itemForTool } from './items.js';

const TOAST_MS = 4500;

/**
 * Short-lived messages at the top right, like the Minecraft "Advancement made" toasts.
 */
export class Toasts {
  constructor(element) {
    this.element = element;
  }

  show(title, message, { icon = 'compass_00', ok = true } = {}) {
    const toast = document.createElement('div');
    toast.className = `toast${ok ? '' : ' toast--warn'}`;
    toast.innerHTML = `${itemIcon(icon, 'toast__icon')}<div><div class="toast__title">${escapeHtml(title)}</div><div class="toast__text">${escapeHtml(message)}</div></div>`;
    this.element.append(toast);
    setTimeout(() => toast.classList.add('toast--out'), TOAST_MS);
    setTimeout(() => toast.remove(), TOAST_MS + 600);
  }
}

function eventIcon(event) {
  if (event.kind === 'tool') return itemForTool(event.tool) ?? 'iron_sword';
  return event.kind === 'prompt' ? 'paper' : 'book';
}

/**
 * History drawer of a session or of one of its sub-agents: the latest messages and tools, and a button to go to the
 * session's terminal.
 */
export class HistoryDrawer {
  constructor(element, { onFocus }) {
    this.element = element;
    this.onFocus = onFocus;
    this.playerId = null;
    element.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) this.close();
      else if (event.target.closest('[data-focus]')) this.onFocus(this.playerId);
    });
    document.addEventListener('keydown', (event) => event.key === 'Escape' && this.close());
  }

  close() {
    this.element.hidden = true;
    this.playerId = null;
    this.showing = null;
  }

  async open(player, loadEvents, villager = null) {
    const showing = `${player.id}/${villager?.id ?? ''}`;
    this.playerId = player.id;
    this.showing = showing;
    this.element.hidden = false;
    this.element.innerHTML = this.frame(player, `<p class="history__empty">${t('loading')}</p>`, villager);
    let events;
    try {
      events = await loadEvents();
    } catch {
      events = null;
    }
    if (this.showing !== showing) return;
    const now = Date.now();
    // A sub-agent's first message is its task, given by the session, not by you.
    const author = (event) => (event.kind === 'prompt' ? t(villager ? 'history.task' : 'history.you')
      : event.kind === 'tool' ? escapeHtml(toolText({ name: event.tool })) : 'Claude');
    const list = events?.length
      ? `<ol class="history__list">${[...events].reverse().map((event) => `<li class="history__item history__item--${event.kind}">
          ${itemIcon(eventIcon(event), 'history__icon')}
          <div><div class="history__meta">${author(event)}${event.at ? ` · ${ago(event.at, now)}` : ''}</div>
          <div class="history__text">${escapeHtml(event.kind === 'tool' ? toolDetail({ ...event, name: event.tool, label: event.text }) : event.text || '')}</div></div></li>`).join('')}</ol>`
      : `<p class="history__empty">${t('history.empty')}</p>`;
    this.element.innerHTML = this.frame(player, list, villager);
  }

  frame(player, body, villager) {
    const title = villager ? villager.description || villager.type : player.name;
    const sub = villager ? `${villager.type} · ${player.name}` : `${player.accountLabel} · ${player.project}`;
    return `<div class="history__panel">
      <header class="history__head"><div><div class="history__title">${escapeHtml(title)}</div>
        <div class="history__sub">${escapeHtml(sub)}</div></div>
        <button type="button" data-focus>${t('session.goToTerminal')}</button><button type="button" data-close title="${t('close')}">✕</button></header>
      ${body}
    </div>`;
  }
}

// Time to answer the macOS Keychain prompt, before reading the account state again.
const KEYCHAIN_CHECK_MS = 8000;
const SOURCES = { oauth: 'settings.source.oauth', sessionKey: 'settings.source.sessionKey' };

/**
 * Where Claude Code keeps its login for this account, and what can be done about it.
 */
function connectionLine(account) {
  if (account.credentialsFile) return `<span class="settings__ok">${t('settings.credentialsFile')}</span>`;
  if (account.keychain) {
    return `<span class="settings__ok">${t('settings.keychainAllowed')}</span><button type="button" data-action="keychain-off">${t('settings.keychainStop')}</button>`;
  }
  if (account.keychainItem) {
    return `<span class="settings__ok">${t('settings.keychainFound')}</span>
      <button type="button" data-action="keychain-on" title="${escapeHtml(t('settings.keychainHint'))}">${t('settings.keychainAllow')}</button>`;
  }
  return `<span class="settings__ok">${t('settings.noConnection')}</span>`;
}

function quotaSource(account) {
  if (SOURCES[account.quotaSource]) return t(SOURCES[account.quotaSource]);
  if (account.quotaError) return t('settings.source.error', { reason: t(`quotaError.${account.quotaError.code}`, account.quotaError) });
  return t('settings.source.statusline');
}

async function postSettings(patch) {
  const response = await fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await response.json();
  if (!response.ok) throw new Error(t(`settingsError.${body.code ?? 'refused'}`));
  return body;
}

/**
 * Settings: the Claude Code accounts found (name, visibility, claude.ai session key), folders added by hand, the
 * weather city. Session keys go to the local server and never come back.
 */
export class SettingsDialog {
  constructor(element, { onChange }) {
    this.element = element;
    this.onChange = onChange;
    element.addEventListener('click', (event) => {
      if (event.target === element || event.target.closest('[data-close]')) this.close();
      const action = event.target.closest('[data-action]');
      if (action) this.act(action.dataset.action, action.closest('[data-account]')?.dataset.account, action);
    });
    element.addEventListener('change', (event) => {
      const row = event.target.closest('[data-account]');
      if (event.target.matches('[data-field="label"]')) this.save({ accounts: { [row.dataset.account]: { label: event.target.value } } });
      if (event.target.matches('[data-field="shown"]')) this.save({ accounts: { [row.dataset.account]: { hidden: !event.target.checked } } });
      if (event.target.matches('[data-field="city"]')) this.save({ city: event.target.value });
    });
    document.addEventListener('keydown', (event) => event.key === 'Escape' && this.close());
  }

  async open() {
    this.element.hidden = false;
    this.element.innerHTML = `<div class="settings__panel"><p class="settings__empty">${t('loading')}</p></div>`;
    await this.refresh();
  }

  close() {
    this.element.hidden = true;
  }

  async refresh(message = '') {
    const [accounts, settings] = await Promise.all([
      fetch('api/accounts').then((response) => response.json()),
      fetch('api/settings').then((response) => response.json()),
    ]);
    this.render(accounts, settings, message);
  }

  async save(patch, message) {
    try {
      await postSettings(patch);
      await this.refresh(message);
      this.onChange();
    } catch (error) {
      await this.refresh(error.message);
    }
  }

  act(action, accountId, button) {
    const row = button.closest('[data-account]');
    if (action === 'save-key') {
      const input = row.querySelector('[data-field="key"]');
      if (input.value.trim()) this.save({ accounts: { [accountId]: { sessionKey: input.value.trim() } } }, t('settings.keySaved'));
    }
    if (action === 'remove-key') this.save({ accounts: { [accountId]: { sessionKey: null } } }, t('settings.keyRemoved'));
    if (action === 'keychain-on') {
      this.save({ accounts: { [accountId]: { keychain: true } } }, t('settings.keychainAsked'));
      setTimeout(() => this.element.hidden || this.refresh(), KEYCHAIN_CHECK_MS);
    }
    if (action === 'keychain-off') this.save({ accounts: { [accountId]: { keychain: false } } }, t('settings.keychainStopped'));
    if (action === 'add-dir') {
      const input = this.element.querySelector('[data-field="dir"]');
      if (input.value.trim()) this.save({ addDir: input.value.trim() }, t('settings.dirAdded'));
    }
    if (action === 'remove-dir') this.save({ removeDir: button.dataset.dir }, t('settings.dirRemoved'));
  }

  render(accounts, settings, message) {
    const rows = accounts.map((account) => `<li class="settings__account" data-account="${escapeHtml(account.id)}">
        <div class="settings__line">
          <i class="settings__chip settings__chip--slot-${(account.slot ?? 0) % 4}${account.hidden ? ' settings__chip--off' : ''}"></i>
          <input data-field="label" value="${escapeHtml(account.label)}" placeholder="${escapeHtml(account.id)}" maxlength="40" aria-label="${t('settings.accountName')}">
          <label class="settings__check"><input type="checkbox" data-field="shown" ${account.hidden ? '' : 'checked'}> ${t('settings.shown')}</label>
        </div>
        <div class="settings__meta"><code>${escapeHtml(account.dir)}</code>${account.plan ? ` · ${escapeHtml(account.plan)}` : ''}
          · ${escapeHtml(quotaSource(account))}
          ${account.custom ? `<button type="button" data-action="remove-dir" data-dir="${escapeHtml(account.dir)}">${t('settings.removeDir')}</button>` : ''}</div>
        <div class="settings__line">${connectionLine(account)}</div>
        <div class="settings__line">${account.hasSessionKey
          ? `<span class="settings__ok">${t('settings.keyStored')}</span><button type="button" data-action="remove-key">${t('settings.remove')}</button>`
          : `<input data-field="key" type="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('settings.keyPlaceholder'))}" aria-label="${t('settings.key')}">
             <button type="button" data-action="save-key">${t('settings.save')}</button>`}</div>
      </li>`).join('');
    this.element.innerHTML = `<div class="settings__panel" role="dialog" aria-label="${t('settings.title')}">
      <header class="settings__head"><h2>${t('settings.title')}</h2><button type="button" data-close title="${t('close')}">✕</button></header>
      ${message ? `<p class="settings__message">${escapeHtml(message)}</p>` : ''}
      <section><h3>${t('settings.accounts')}</h3>
        <p class="settings__hint">${escapeHtml(t('settings.accountsHint'))}</p>
        <ul class="settings__accounts">${rows || `<li class="settings__empty">${t('settings.noAccount')}</li>`}</ul>
        <div class="settings__line"><input data-field="dir" placeholder="${escapeHtml(t('settings.dirPlaceholder'))}" aria-label="${t('settings.dir')}">
          <button type="button" data-action="add-dir">${t('settings.add')}</button></div>
      </section>
      <section><h3>${t('settings.weather')}</h3>
        <div class="settings__line"><input data-field="city" value="${escapeHtml(settings.city ?? '')}" placeholder="${escapeHtml(t('settings.cityPlaceholder'))}" maxlength="80" aria-label="${t('settings.city')}"></div>
      </section>
    </div>`;
  }
}
