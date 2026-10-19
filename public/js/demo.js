// Page de test (/demo) : des sessions et des agents factices dans tous les états, pour voir chaque rendu.
// Les outils tournent à chaque tour, ce qui fait passer les joueurs par tous leurs meubles.

// Deux comptes factices : `perso` (le dossier ~/.claude) et `travail` (un second dossier de config).
const ACCOUNTS = [
  { id: 'claude', label: 'perso', slot: 0, plan: 'Max 5x' },
  { id: 'claude-work', label: 'travail', slot: 1, plan: 'Team' },
];

export const DEMO_SCENARIOS = [
  { id: 'nether-end', label: 'perso au Nether, travail dans l\'End', themes: { claude: 'nether', 'claude-work': 'end' } },
  { id: 'normal', label: 'Tout normal', themes: { claude: 'normal', 'claude-work': 'normal' } },
  { id: 'nether-one', label: 'perso au Nether (quota 5 h)', themes: { claude: 'nether', 'claude-work': 'normal' } },
  { id: 'end-one', label: 'travail dans l\'End (quota semaine)', themes: { claude: 'normal', 'claude-work': 'end' } },
  { id: 'all-nether', label: 'Les deux au Nether', themes: { claude: 'nether', 'claude-work': 'nether' } },
  { id: 'all-end', label: 'Les deux dans l\'End', themes: { claude: 'end', 'claude-work': 'end' } },
];

const HOUR = 60 * 60 * 1000;
// null : pas d'outil en cours, le joueur réfléchit à la bibliothèque.
const TOOL_CYCLE = [
  { name: 'Bash', label: 'npm run build' },
  { name: 'Edit', label: 'world.js' },
  { name: 'Read', label: 'layout.js' },
  { name: 'WebSearch', label: 'textures du Nether' },
  null,
  { name: 'Grep', label: 'resetsAt' },
];

// Sessions de test : statut fixe, outils qui tournent pour celles qui travaillent.
const SESSIONS = [
  {
    account: 'claude-work', name: 'Bug de synchro des paiements', project: 'shop/api', status: 'working', context: 64, cost: 12.4,
    prompt: 'Les paiements ne se synchronisent plus depuis la dernière mise en prod',
    agents: [['Explore', 'Chercher les appels au webhook', 'working'], ['general-purpose', 'Écrire le test de non-régression', 'done']],
    tasks: ['Reproduire le bug', 'Trouver l\'appel qui échoue', 'Corriger le webhook', 'Test de non-régression', 'Relire le diff'],
    git: { branch: 'fix/payment-sync', changed: 3, untracked: 1 },
  },
  {
    account: 'claude-work', name: 'Revue de la PR #128', project: 'shop/web', status: 'waiting', waitingFor: 'input needed', context: 41, cost: 6.1,
    text: 'Je pousse la branche et j\'ouvre la PR, ou tu veux relire le diff avant ?', waitingMinutes: 9,
    git: { branch: 'feature/checkout-v2', ahead: 2 },
  },
  {
    account: 'claude-work', name: 'Migration de la base clients', project: 'crm', status: 'done', context: 22, cost: 3.2,
    text: 'Les trois migrations passent, il reste à les valider en recette.',
    tasks: ['Migration 041', 'Migration 042', 'Migration 043'], tasksDone: 3, git: { branch: 'main' },
  },
  {
    account: 'claude', name: 'MineTokenCraft', project: 'minetokencraft', status: 'working', context: 78, cost: 31.8,
    prompt: 'Fais-moi une page de test avec tous les rendus possibles',
    agents: [
      ['Explore', 'Inventaire des textures', 'working'],
      ['general-purpose', 'Écrire la page de démo', 'working'],
      ['Plan', 'Plan du thème End', 'done'],
      ['claude', 'Relire le README', 'working'],
    ],
    tasks: ['Skins', 'Thème Nether', 'Thème End', 'Page de test', 'Favicon', 'Quotas dans les bannières', 'README'],
  },
  {
    account: 'claude', name: 'Boutique de modèles 3D', project: '3d-store', status: 'working', context: 93, cost: 907, stuck: true,
    prompt: 'Passe en revue toutes les pages produit', agents: [['general-purpose', 'Polish the product pages', 'working']],
    git: { branch: 'main', changed: 31, untracked: 14 },
  },
  {
    account: 'claude', name: 'Jeu de plateau en ligne', project: 'board-game', status: 'waiting', waitingFor: 'dialog open', context: 35, cost: 18,
    text: 'Quel style de plateau tu préfères : bois clair ou ardoise ?', waitingMinutes: 2, git: { branch: 'main', changed: 2 },
  },
  {
    account: 'claude', name: 'Blog personnel', project: 'blog', status: 'done', context: 52, cost: 44,
    text: 'Le flux RSS est en place et validé.',
  },
];

/**
 * Liste de tâches de test : elle avance d'une tâche tous les quelques tours.
 */
function demoTasks(subjects, tick, done) {
  if (!subjects) return null;
  const finished = done ?? Math.min(subjects.length, 1 + Math.floor(tick / 2) % subjects.length);
  const current = finished < subjects.length ? subjects[finished] : null;
  return {
    done: finished,
    total: subjects.length,
    current,
    items: subjects.map((subject, index) => ({ subject, status: index < finished ? 'completed' : index === finished ? 'in_progress' : 'pending' })),
  };
}

const DEMO_HISTORY = [
  ['prompt', null, 'Les paiements ne se synchronisent plus depuis la dernière mise en prod'],
  ['tool', 'Grep', 'syncPayment'],
  ['tool', 'Read', 'src/payments/webhook.ts'],
  ['text', null, 'Le webhook part avant que la transaction soit validée : je déplace l\'envoi après le commit.'],
  ['tool', 'Edit', 'src/payments/webhook.ts'],
  ['tool', 'Bash', 'npm test -- payments'],
  ['text', null, 'Les tests passent. Je relis le diff avant de te le montrer.'],
];

export function demoHistory() {
  const now = Date.now();
  return DEMO_HISTORY.map(([kind, tool, text], index) => ({ at: now - (DEMO_HISTORY.length - index) * 90 * 1000, kind, tool, text }));
}

const SLEEPERS = [
  ['claude-work', 'Ticket SUP-2041', 'shop/api'],
  ['claude', 'Idées de jeu concours', '~'],
  ['claude', 'Appli de barre de menus', 'menubar-app'],
];

// Journée de test : une matinée chargée au travail, une soirée côté perso.
function demoStats(now) {
  const currentHour = new Date(now).getHours();
  const curve = (peak, height) => Array.from({ length: 24 }, (_, hour) => {
    if (hour > currentHour) return { tokens: 0, cost: 0 };
    const tokens = Math.max(0, Math.round(height * Math.exp(-((hour - peak) ** 2) / 8)));
    return { tokens, cost: tokens * 0.0000004 };
  });
  const day = (hours, sessions, agents) => ({
    hours, sessions, agents,
    tokens: hours.reduce((sum, hour) => sum + hour.tokens, 0),
    cost: hours.reduce((sum, hour) => sum + hour.cost, 0),
  });
  return { day: 'demo', accounts: { 'claude-work': day(curve(10, 90e6), 3, 6), claude: day(curve(Math.min(currentHour, 15), 140e6), 4, 9) } };
}

function usageFor(theme, now) {
  return {
    fiveHour: { usedPct: theme === 'nether' ? 100 : 46, resetsAt: now + 2 * HOUR },
    sevenDay: { usedPct: theme === 'end' ? 100 : 38, resetsAt: now + 3 * 24 * HOUR },
  };
}

// Prévision de test : le 5 h d'un compte normal file vers l'épuisement avant sa remise à zéro.
function forecastFor(theme, now) {
  return { fiveHour: theme === 'normal' ? { holds: false, eta: now + 75 * 60 * 1000 } : null, sevenDay: { holds: true, eta: null } };
}

export function demoState(scenarioId, tick, { now = Date.now(), hidden = new Set() } = {}) {
  const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === scenarioId) ?? DEMO_SCENARIOS[0];
  const accounts = ACCOUNTS.map((account) => ({
    ...account, usage: usageFor(scenario.themes[account.id], now), forecast: forecastFor(scenario.themes[account.id], now),
  }));
  const accountOf = (id) => ACCOUNTS.find((account) => account.id === id);
  const players = SESSIONS.map((session, index) => {
    const tool = session.status === 'working' ? TOOL_CYCLE[(tick + index) % TOOL_CYCLE.length] : null;
    return {
      id: `demo:${index}`,
      account: session.account,
      accountLabel: accountOf(session.account).label,
      accountSlot: accountOf(session.account).slot,
      kind: 'interactive',
      name: session.name,
      project: session.project,
      status: session.status,
      waitingFor: session.waitingFor ?? null,
      waitingSince: session.waitingMinutes ? now - session.waitingMinutes * 60 * 1000 : null,
      stuck: session.stuck ?? false,
      tasks: demoTasks(session.tasks, tick, session.tasksDone),
      git: session.git ? { ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0, ...session.git } : null,
      tool,
      thinking: session.status === 'working' && !tool,
      lastPrompt: session.prompt ?? null,
      lastText: session.text ?? null,
      context: { tokens: session.context * 10000, size: 1000000, pct: session.context },
      costUSD: session.cost,
      startedAt: now - (index + 1) * HOUR,
      lastActivityAt: now - (session.status === 'done' ? 4 * 60 * 1000 : session.stuck ? 11 * 60 * 1000 : 5000),
      villagers: (session.agents ?? []).map(([type, description, status], agent) => ({
        id: `demo:${index}:${agent}`,
        type,
        description,
        status,
        tool: status === 'working' ? TOOL_CYCLE[(tick + agent + 1) % TOOL_CYCLE.length] ?? TOOL_CYCLE[0] : null,
        startedAt: now - (10 - agent) * 60 * 1000,
        endedAt: status === 'done' ? now - 60 * 1000 : null,
      })),
    };
  });
  // Session de test qu'on a fait partir : elle disparaît du village le temps de voir son départ.
  for (let index = players.length - 1; index >= 0; index--) if (hidden.has(players[index].id)) players.splice(index, 1);
  for (const [index, [account, name, project]] of SLEEPERS.entries()) {
    players.push({
      id: `demo:sleep:${index}`, account, accountLabel: accountOf(account).label, accountSlot: accountOf(account).slot, kind: 'interactive', name, project,
      status: 'sleeping', waitingFor: null, tool: null, thinking: false, lastPrompt: null, lastText: null,
      context: { tokens: null, size: null, pct: null }, costUSD: null, startedAt: now - 30 * HOUR,
      lastActivityAt: now - (index + 2) * 24 * HOUR, villagers: [],
    });
  }
  return { now, accounts, players, stats: demoStats(now) };
}
