export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const BIOMES = ['plains', 'desert', 'jungle', 'savanna', 'snow', 'swamp', 'taiga'];

// Tous les villageois d'un même joueur partagent la tenue d'un biome.
export function biomeFor(playerId) {
  return BIOMES[hash(playerId) % BIOMES.length];
}

// Métier du villageois selon le type de sous-agent.
const PROFESSIONS = {
  Explore: 'cartographer',
  Plan: 'librarian',
  'general-purpose': 'farmer',
  claude: 'cleric',
  'claude-code-guide': 'librarian',
  fork: 'mason',
  'statusline-setup': 'leatherworker',
};
const OTHER_PROFESSIONS = ['armorer', 'butcher', 'fisherman', 'fletcher', 'shepherd', 'toolsmith', 'weaponsmith'];

export function professionFor(agentType, villagerId) {
  return PROFESSIONS[agentType] ?? OTHER_PROFESSIONS[hash(villagerId) % OTHER_PROFESSIONS.length];
}

// Bloc de métier devant lequel travaille chaque villageois, comme dans Minecraft (types de blocs de world.js).
export const JOB_BLOCKS = {
  armorer: 'blastFurnace',
  butcher: 'smoker',
  cartographer: 'cartography',
  cleric: 'barrel',
  farmer: 'composter',
  fisherman: 'barrel',
  fletcher: 'fletching',
  leatherworker: 'barrel',
  librarian: 'lectern',
  mason: 'smoothStone',
  shepherd: 'loom',
  toolsmith: 'smithing',
  weaponsmith: 'smithing',
};
