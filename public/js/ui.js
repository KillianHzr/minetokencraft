import { ago, escapeHtml, toolText } from './format.js';
import { itemIcon } from './widgets.js';
import { itemForTool } from './items.js';

const TOAST_MS = 4500;

/**
 * Messages éphémères en haut à droite, façon « Progrès réalisé » de Minecraft.
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
 * Volet d'historique d'une session : ses derniers échanges et outils, et un bouton pour aller à son terminal.
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
  }

  async open(player, loadEvents) {
    this.playerId = player.id;
    this.element.hidden = false;
    this.element.innerHTML = this.frame(player, '<p class="history__empty">Chargement…</p>');
    let events;
    try {
      events = await loadEvents(player.id);
    } catch {
      events = null;
    }
    if (this.playerId !== player.id) return;
    const now = Date.now();
    const list = events?.length
      ? `<ol class="history__list">${[...events].reverse().map((event) => `<li class="history__item history__item--${event.kind}">
          ${itemIcon(eventIcon(event), 'history__icon')}
          <div><div class="history__meta">${event.kind === 'prompt' ? 'Toi' : event.kind === 'tool' ? escapeHtml(toolText({ name: event.tool })) : 'Claude'}${event.at ? ` · ${ago(event.at, now)}` : ''}</div>
          <div class="history__text">${escapeHtml(event.text || '')}</div></div></li>`).join('')}</ol>`
      : '<p class="history__empty">Pas d\'historique lisible pour cette session.</p>';
    this.element.innerHTML = this.frame(player, list);
  }

  frame(player, body) {
    return `<div class="history__panel">
      <header class="history__head"><div><div class="history__title">${escapeHtml(player.name)}</div>
        <div class="history__sub">${escapeHtml(player.accountLabel)} · ${escapeHtml(player.project)}</div></div>
        <button type="button" data-focus>Aller au terminal</button><button type="button" data-close title="Fermer">✕</button></header>
      ${body}
    </div>`;
  }
}

// Le temps de répondre à la demande d'accès au trousseau, avant de relire l'état des comptes.
const KEYCHAIN_CHECK_MS = 8000;
const SOURCES = {
  oauth: 'quotas lus auprès d\'Anthropic',
  sessionKey: 'quotas lus auprès de claude.ai',
};

/**
 * D'où vient la connexion de Claude Code pour ce compte, et ce qu'on peut y faire.
 */
function connectionLine(account) {
  if (account.credentialsFile) return '<span class="settings__ok">Connexion de Claude Code lue dans .credentials.json</span>';
  if (account.keychain) {
    return '<span class="settings__ok">Lecture du trousseau autorisée</span><button type="button" data-action="keychain-off">Ne plus lire</button>';
  }
  if (account.keychainItem) {
    return `<span class="settings__ok">Connexion de Claude Code rangée dans le trousseau macOS.</span>
      <button type="button" data-action="keychain-on" title="macOS va demander l'autorisation : choisis « Toujours autoriser »">Autoriser la lecture</button>`;
  }
  return '<span class="settings__ok">Pas de connexion Claude Code trouvée : colle une clé de session claude.ai, ou installe la status line.</span>';
}

async function postSettings(patch) {
  const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? 'Réglage refusé.');
  return body;
}

/**
 * Réglages : les comptes Claude Code trouvés (nom, affichage, clé de session claude.ai), les dossiers ajoutés à la
 * main, la ville de la météo. Les clés de session partent au serveur local et n'en reviennent jamais.
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
    this.element.innerHTML = '<div class="settings__panel"><p class="settings__empty">Chargement…</p></div>';
    await this.refresh();
  }

  close() {
    this.element.hidden = true;
  }

  async refresh(message = '') {
    const [accounts, settings] = await Promise.all([
      fetch('/api/accounts').then((response) => response.json()),
      fetch('/api/settings').then((response) => response.json()),
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
      if (input.value.trim()) this.save({ accounts: { [accountId]: { sessionKey: input.value.trim() } } }, 'Clé de session enregistrée.');
    }
    if (action === 'remove-key') this.save({ accounts: { [accountId]: { sessionKey: null } } }, 'Clé de session retirée.');
    if (action === 'keychain-on') {
      this.save({ accounts: { [accountId]: { keychain: true } } }, 'macOS va demander l\'accès au trousseau : choisis « Toujours autoriser ». Les quotas arrivent ensuite.');
      setTimeout(() => this.element.hidden || this.refresh(), KEYCHAIN_CHECK_MS);
    }
    if (action === 'keychain-off') this.save({ accounts: { [accountId]: { keychain: false } } }, 'Le trousseau ne sera plus lu pour ce compte.');
    if (action === 'add-dir') {
      const input = this.element.querySelector('[data-field="dir"]');
      if (input.value.trim()) this.save({ addDir: input.value.trim() }, 'Dossier ajouté : il apparaît s\'il contient une config Claude Code.');
    }
    if (action === 'remove-dir') this.save({ removeDir: button.dataset.dir }, 'Dossier retiré.');
  }

  render(accounts, settings, message) {
    const rows = accounts.map((account) => `<li class="settings__account" data-account="${escapeHtml(account.id)}">
        <div class="settings__line">
          <i class="settings__chip settings__chip--slot-${(account.slot ?? 0) % 4}${account.hidden ? ' settings__chip--off' : ''}"></i>
          <input data-field="label" value="${escapeHtml(account.label)}" placeholder="${escapeHtml(account.id)}" maxlength="40" aria-label="Nom du compte">
          <label class="settings__check"><input type="checkbox" data-field="shown" ${account.hidden ? '' : 'checked'}> affiché</label>
        </div>
        <div class="settings__meta"><code>${escapeHtml(account.dir)}</code>${account.plan ? ` · ${escapeHtml(account.plan)}` : ''}
          · ${escapeHtml(SOURCES[account.quotaSource] ?? (account.quotaError ? `quotas indisponibles : ${account.quotaError}` : 'quotas lus dans la status line, si elle est installée'))}
          ${account.custom ? `<button type="button" data-action="remove-dir" data-dir="${escapeHtml(account.dir)}">retirer ce dossier</button>` : ''}</div>
        <div class="settings__line">${connectionLine(account)}</div>
        <div class="settings__line">${account.hasSessionKey
          ? '<span class="settings__ok">Clé de session claude.ai enregistrée</span><button type="button" data-action="remove-key">Retirer</button>'
          : `<input data-field="key" type="password" autocomplete="off" spellcheck="false" placeholder="Clé de session claude.ai (facultatif) : sk-ant-sid…" aria-label="Clé de session">
             <button type="button" data-action="save-key">Enregistrer</button>`}</div>
      </li>`).join('');
    this.element.innerHTML = `<div class="settings__panel" role="dialog" aria-label="Réglages">
      <header class="settings__head"><h2>Réglages</h2><button type="button" data-close title="Fermer">✕</button></header>
      ${message ? `<p class="settings__message">${escapeHtml(message)}</p>` : ''}
      <section><h3>Comptes Claude Code</h3>
        <p class="settings__hint">Un compte par dossier de config (~/.claude, ~/.claude-*, CLAUDE_CONFIG_DIR), trouvé seul. Les quotas
          viennent de la connexion de Claude Code ; une clé de session claude.ai sert de secours. Elle reste sur cette machine.</p>
        <ul class="settings__accounts">${rows || '<li class="settings__empty">Aucun dossier de config Claude Code trouvé.</li>'}</ul>
        <div class="settings__line"><input data-field="dir" placeholder="Autre dossier de config, ex. ~/work/.claude" aria-label="Dossier à ajouter">
          <button type="button" data-action="add-dir">Ajouter</button></div>
      </section>
      <section><h3>Météo</h3>
        <div class="settings__line"><input data-field="city" value="${escapeHtml(settings.city ?? '')}" placeholder="Ville (vide : celle du fuseau horaire)" maxlength="80" aria-label="Ville"></div>
      </section>
    </div>`;
  }
}
