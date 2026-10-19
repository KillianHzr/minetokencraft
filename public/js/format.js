export const STATUS_ICONS = { waiting: '!', working: '⚒', done: '✔', sleeping: 'z', leaving: '→' };
// Un Claude qui t'attend depuis plus longtemps que ça passe en alerte renforcée (même seuil que le serveur).
export const WAITING_URGENT_MS = 5 * 60 * 1000;

export const STATUS_TITLES = {
  waiting: "T'attendent",
  working: 'Au travail',
  done: 'Ont fini',
  sleeping: 'Inactives',
};

const WAITING_TEXTS = {
  'input needed': 'attend ta réponse',
  'dialog open': 'attend ton choix',
  'sandbox request': 'demande un accès réseau',
  'goal proposal': 'propose un objectif',
};

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function truncate(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function ago(timestamp, now = Date.now()) {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function clockTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (timestamp - now < 20 * 60 * 60 * 1000) return time;
  return `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${time}`;
}

export function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1).replace('.', ',')}M`;
  return `${Math.round(tokens / 1000)}k`;
}

export function formatCost(cost) {
  return cost ? `${cost < 10 ? cost.toFixed(2).replace('.', ',') : Math.round(cost)} $` : '';
}

export function toolText(tool) {
  if (!tool) return '';
  const name = tool.name.startsWith('mcp__') ? tool.name.split('__')[1] : tool.name;
  return tool.label ? `${name} · ${tool.label}` : name;
}

export function workingVillagers(player) {
  return player.villagers.filter((villager) => villager.status === 'working').length;
}

export function isUrgent(player, now = Date.now()) {
  return player.status === 'waiting' && player.waitingSince != null && now - player.waitingSince > WAITING_URGENT_MS;
}

/**
 * Ce que fait le joueur, en une ligne courte (étiquette et panneau).
 */
export function playerActivity(player, now = Date.now()) {
  switch (player.status) {
    case 'waiting': {
      const what = WAITING_TEXTS[player.waitingFor] ?? (player.waitingFor || 'attend ta réponse');
      return player.waitingSince ? `${what} · depuis ${ago(player.waitingSince, now)}` : what;
    }
    case 'leaving':
      return 's\'en va…';
    case 'working': {
      if (player.stuck) return `rien depuis ${ago(player.lastActivityAt, now)}${player.tool ? ` · ${toolText(player.tool)}` : ''}`;
      if (player.tool) return toolText(player.tool);
      if (player.thinking) return 'réfléchit…';
      const helpers = workingVillagers(player);
      return helpers ? `attend ${helpers} villageois` : 'travaille';
    }
    case 'done':
      return `a fini · ${ago(player.lastActivityAt, now)}`;
    default:
      return ago(player.lastActivityAt, now);
  }
}

/**
 * Niveau de remplissage en bleu / jaune / orange, comme la status line (lisible en daltonisme).
 */
// Couleurs et styles d'aile des comptes : quatre jeux, attribués dans l'ordre des comptes, puis on recommence.
export const ACCOUNT_SLOTS = 4;

export function slotClass(slot) {
  return `slot-${(slot ?? 0) % ACCOUNT_SLOTS}`;
}

export function levelClass(pct) {
  if (pct >= 80) return 'level--high';
  if (pct >= 50) return 'level--mid';
  return 'level--low';
}

/**
 * Branche git et état du dossier, comme dans la status line : ⎇ branche ✚ modifiés ? non suivis ↑ en avance.
 */
export function gitText(git) {
  if (!git?.branch) return '';
  const marks = [
    git.conflicts && `✖${git.conflicts}`,
    git.changed && `✚${git.changed}`,
    git.untracked && `?${git.untracked}`,
    git.ahead && `↑${git.ahead}`,
    git.behind && `↓${git.behind}`,
  ].filter(Boolean);
  return `⎇ ${git.branch}${marks.length ? ` ${marks.join(' ')}` : ''}`;
}

/**
 * Prévision d'un quota : l'heure à laquelle il sera épuisé si on continue au rythme de la dernière heure.
 */
export function forecastText(forecast, now = Date.now()) {
  if (!forecast?.eta) return '';
  return `épuisé vers ${clockTime(forecast.eta, now)} à ce rythme`;
}

/**
 * Avancement d'une liste de tâches en une ligne : 3/7 et la tâche en cours.
 */
export function tasksText(tasks) {
  if (!tasks?.total) return '';
  return `${tasks.done}/${tasks.total}${tasks.current ? ` · ${tasks.current}` : ''}`;
}
