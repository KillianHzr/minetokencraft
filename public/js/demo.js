import { LANGUAGE } from './i18n.js';

// Test page (/demo): fake sessions and agents in every state, to see each rendering. Tools rotate on every tick,
// which walks the players past all their furniture.

// Demo text in each language: { en, fr }, English when the page language has no translation.
const local = (text) => (typeof text === 'string' ? text : text[LANGUAGE] ?? text.en);

// Two fake accounts: `personal` (the ~/.claude folder) and `work` (a second config folder).
const ACCOUNTS = [
  { id: 'claude', label: { en: 'personal', fr: 'perso' }, slot: 0, plan: 'Max 5x' },
  { id: 'claude-work', label: { en: 'work', fr: 'travail' }, slot: 1, plan: 'Team' },
];

// Labels in the locales, under demo.scenario.<id>.
export const DEMO_SCENARIOS = [
  { id: 'nether-end', themes: { claude: 'nether', 'claude-work': 'end' } },
  { id: 'normal', themes: { claude: 'normal', 'claude-work': 'normal' } },
  { id: 'nether-one', themes: { claude: 'nether', 'claude-work': 'normal' } },
  { id: 'end-one', themes: { claude: 'normal', 'claude-work': 'end' } },
  { id: 'all-nether', themes: { claude: 'nether', 'claude-work': 'nether' } },
  { id: 'all-end', themes: { claude: 'end', 'claude-work': 'end' } },
];

const HOUR = 60 * 60 * 1000;
// null: no tool running, the player thinks at the bookshelf.
const TOOL_CYCLE = [
  { name: 'Bash', label: 'npm run build' },
  { name: 'Edit', label: 'world.js' },
  { name: 'Read', label: 'layout.js' },
  { name: 'WebSearch', label: { en: 'Nether textures', fr: 'textures du Nether' } },
  null,
  { name: 'Grep', label: 'resetsAt' },
];

// Test sessions: fixed status, rotating tools for the ones at work.
const SESSIONS = [
  {
    account: 'claude-work', name: { en: 'Payment sync bug', fr: 'Bug de synchro des paiements' }, project: 'shop/api', status: 'working', context: 64, cost: 12.4,
    prompt: { en: 'Payments stopped syncing after the last release', fr: 'Les paiements ne se synchronisent plus depuis la dernière mise en prod' },
    agents: [
      ['Explore', { en: 'Find the webhook calls', fr: 'Chercher les appels au webhook' }, 'working'],
      ['general-purpose', { en: 'Write the regression test', fr: 'Écrire le test de non-régression' }, 'done'],
    ],
    tasks: [
      { en: 'Reproduce the bug', fr: 'Reproduire le bug' },
      { en: 'Find the failing call', fr: 'Trouver l\'appel qui échoue' },
      { en: 'Fix the webhook', fr: 'Corriger le webhook' },
      { en: 'Regression test', fr: 'Test de non-régression' },
      { en: 'Review the diff', fr: 'Relire le diff' },
    ],
    git: { branch: 'fix/payment-sync', changed: 3, untracked: 1 },
  },
  {
    account: 'claude-work', name: { en: 'Review of PR #128', fr: 'Revue de la PR #128' }, project: 'shop/web', status: 'waiting', waitingFor: 'input needed', context: 41, cost: 6.1,
    text: { en: 'Should I push the branch and open the PR, or do you want to read the diff first?', fr: 'Je pousse la branche et j\'ouvre la PR, ou tu veux relire le diff avant ?' },
    waitingMinutes: 9, git: { branch: 'feature/checkout-v2', ahead: 2 },
  },
  {
    account: 'claude-work', name: { en: 'Customer database migration', fr: 'Migration de la base clients' }, project: 'crm', status: 'done', context: 22, cost: 3.2,
    text: { en: 'All three migrations pass, they still need to be checked on staging.', fr: 'Les trois migrations passent, il reste à les valider en recette.' },
    tasks: ['Migration 041', 'Migration 042', 'Migration 043'], tasksDone: 3, git: { branch: 'main' },
  },
  {
    account: 'claude', name: 'MineTokenCraft', project: 'minetokencraft', status: 'working', context: 78, cost: 31.8,
    prompt: { en: 'Make me a test page with every possible rendering', fr: 'Fais-moi une page de test avec tous les rendus possibles' },
    agents: [
      ['Explore', { en: 'Texture inventory', fr: 'Inventaire des textures' }, 'working'],
      ['general-purpose', { en: 'Write the demo page', fr: 'Écrire la page de démo' }, 'working'],
      ['Plan', { en: 'Plan the End theme', fr: 'Plan du thème End' }, 'done'],
      ['claude', { en: 'Proofread the README', fr: 'Relire le README' }, 'working'],
    ],
    tasks: [
      'Skins',
      { en: 'Nether theme', fr: 'Thème Nether' },
      { en: 'End theme', fr: 'Thème End' },
      { en: 'Test page', fr: 'Page de test' },
      'Favicon',
      { en: 'Quotas in the banners', fr: 'Quotas dans les bannières' },
      'README',
    ],
  },
  {
    account: 'claude', name: { en: '3D model store', fr: 'Boutique de modèles 3D' }, project: '3d-store', status: 'working', context: 93, cost: 907, stuck: true,
    prompt: { en: 'Go through every product page', fr: 'Passe en revue toutes les pages produit' },
    agents: [['general-purpose', { en: 'Polish the product pages', fr: 'Peaufiner les pages produit' }, 'working']],
    git: { branch: 'main', changed: 31, untracked: 14 },
  },
  {
    account: 'claude', name: { en: 'Online board game', fr: 'Jeu de plateau en ligne' }, project: 'board-game', status: 'waiting', waitingFor: 'dialog open', context: 35, cost: 18,
    text: { en: 'Which board style do you prefer: light wood or slate?', fr: 'Quel style de plateau tu préfères : bois clair ou ardoise ?' },
    waitingMinutes: 2, git: { branch: 'main', changed: 2 },
  },
  {
    account: 'claude', name: { en: 'Personal blog', fr: 'Blog personnel' }, project: 'blog', status: 'done', context: 52, cost: 44,
    text: { en: 'The RSS feed is in place and validated.', fr: 'Le flux RSS est en place et validé.' },
  },
];

/**
 * Test task list: it moves forward one task every few ticks.
 */
function demoTasks(subjects, tick, done) {
  if (!subjects) return null;
  const finished = done ?? Math.min(subjects.length, 1 + Math.floor(tick / 2) % subjects.length);
  const current = finished < subjects.length ? subjects[finished] : null;
  return {
    done: finished,
    total: subjects.length,
    current: current && local(current),
    items: subjects.map((subject, index) => ({ subject: local(subject), status: index < finished ? 'completed' : index === finished ? 'in_progress' : 'pending' })),
  };
}

const DEMO_HISTORY = [
  ['prompt', null, SESSIONS[0].prompt],
  ['tool', 'Grep', 'syncPayment'],
  ['tool', 'Read', 'src/payments/webhook.ts'],
  ['text', null, { en: 'The webhook fires before the transaction is committed: I am moving the call after the commit.', fr: 'Le webhook part avant que la transaction soit validée : je déplace l\'envoi après le commit.' }],
  ['tool', 'Edit', 'src/payments/webhook.ts'],
  ['tool', 'Bash', 'npm test -- payments'],
  ['text', null, { en: 'Tests pass. I am reading the diff again before showing it to you.', fr: 'Les tests passent. Je relis le diff avant de te le montrer.' }],
];

export function demoHistory() {
  const now = Date.now();
  return DEMO_HISTORY.map(([kind, tool, text], index) => ({ at: now - (DEMO_HISTORY.length - index) * 90 * 1000, kind, tool, text: local(text) }));
}

const SLEEPERS = [
  ['claude-work', 'Ticket SUP-2041', 'shop/api'],
  ['claude', { en: 'Giveaway ideas', fr: 'Idées de jeu concours' }, '~'],
  ['claude', { en: 'Menu bar app', fr: 'Appli de barre de menus' }, 'menubar-app'],
];

// Test day: a busy morning at work, an evening on the personal side.
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

// Test forecast: the 5-hour quota of a normal account heads for running out before it resets.
function forecastFor(theme, now) {
  return { fiveHour: theme === 'normal' ? { holds: false, eta: now + 75 * 60 * 1000 } : null, sevenDay: { holds: true, eta: null } };
}

function toolAt(index) {
  const tool = TOOL_CYCLE[index % TOOL_CYCLE.length];
  return tool && { ...tool, label: local(tool.label) };
}

export function demoState(scenarioId, tick, { now = Date.now(), hidden = new Set() } = {}) {
  const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === scenarioId) ?? DEMO_SCENARIOS[0];
  const accounts = ACCOUNTS.map((account) => ({
    ...account, label: local(account.label), usage: usageFor(scenario.themes[account.id], now), forecast: forecastFor(scenario.themes[account.id], now),
  }));
  const accountOf = (id) => accounts.find((account) => account.id === id);
  const players = SESSIONS.map((session, index) => {
    const tool = session.status === 'working' ? toolAt(tick + index) : null;
    return {
      id: `demo:${index}`,
      account: session.account,
      accountLabel: accountOf(session.account).label,
      accountSlot: accountOf(session.account).slot,
      kind: 'interactive',
      name: local(session.name),
      project: session.project,
      status: session.status,
      waitingFor: session.waitingFor ?? null,
      waitingSince: session.waitingMinutes ? now - session.waitingMinutes * 60 * 1000 : null,
      stuck: session.stuck ?? false,
      tasks: demoTasks(session.tasks, tick, session.tasksDone),
      git: session.git ? { ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0, ...session.git } : null,
      tool,
      thinking: session.status === 'working' && !tool,
      lastPrompt: session.prompt ? local(session.prompt) : null,
      lastText: session.text ? local(session.text) : null,
      context: { tokens: session.context * 10000, size: 1000000, pct: session.context },
      costUSD: session.cost,
      startedAt: now - (index + 1) * HOUR,
      lastActivityAt: now - (session.status === 'done' ? 4 * 60 * 1000 : session.stuck ? 11 * 60 * 1000 : 5000),
      villagers: (session.agents ?? []).map(([type, description, status], agent) => ({
        id: `demo:${index}:${agent}`,
        type,
        description: local(description),
        status,
        tool: status === 'working' ? toolAt(tick + agent + 1) ?? toolAt(0) : null,
        startedAt: now - (10 - agent) * 60 * 1000,
        endedAt: status === 'done' ? now - 60 * 1000 : null,
      })),
    };
  });
  // Test session sent away: it leaves the village long enough to watch it go.
  for (let index = players.length - 1; index >= 0; index--) if (hidden.has(players[index].id)) players.splice(index, 1);
  for (const [index, [account, name, project]] of SLEEPERS.entries()) {
    players.push({
      id: `demo:sleep:${index}`, account, accountLabel: accountOf(account).label, accountSlot: accountOf(account).slot, kind: 'interactive', name: local(name), project,
      status: 'sleeping', waitingFor: null, tool: null, thinking: false, lastPrompt: null, lastText: null,
      context: { tokens: null, size: null, pct: null }, costUSD: null, startedAt: now - 30 * HOUR,
      lastActivityAt: now - (index + 2) * 24 * HOUR, villagers: [],
    });
  }
  return { now, accounts, players, stats: demoStats(now) };
}
