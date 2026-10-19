// Télécharge dans assets/ les textures Minecraft, la police et des skins de joueurs. Ces fichiers appartiennent à
// leurs auteurs (Mojang pour les textures) : ils restent sur la machine et ne sont jamais versionnés.
// Usage : minetokencraft assets [--refresh-skins] [--skins pseudo1,pseudo2,…]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS_DIR } from '../config.mjs';

const assetsDir = ASSETS_DIR;

const TEXTURES_BASE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.1/assets/minecraft/textures/';
const FONT_URL = 'https://raw.githubusercontent.com/IdreesInc/Minecraft-Font/main/Minecraft.otf';

const TEXTURES = [
  ...[
    'grass_block_top', 'grass_block_side', 'grass_block_side_overlay', 'dirt', 'stone', 'cobblestone',
    'dirt_path_top', 'dirt_path_side', 'oak_planks', 'oak_log', 'oak_log_top', 'spruce_planks', 'glass',
    'oak_leaves', 'red_wool', 'white_wool', 'crafting_table_top', 'crafting_table_front', 'crafting_table_side',
    'bookshelf', 'hay_block_side', 'hay_block_top', 'short_grass', 'poppy', 'dandelion', 'cornflower',
    'oxeye_daisy', 'oak_door_bottom', 'oak_door_top', 'cobblestone', 'lantern',
    // Maisons en coupe : murs, sols, toits, lumières et postes de travail.
    'stone_bricks', 'polished_andesite', 'smooth_stone', 'birch_planks', 'acacia_planks', 'dark_oak_planks', 'bricks',
    'deepslate_tiles', 'sea_lantern', 'glowstone', 'shroomlight', 'light_blue_wool', 'blue_wool', 'orange_wool',
    'yellow_wool', 'white_concrete', 'spruce_log', 'stripped_oak_log', 'stripped_spruce_log', 'flower_pot',
    'furnace_front', 'furnace_front_on', 'furnace_side', 'furnace_top',
    'cartography_table_top', 'cartography_table_side1', 'cartography_table_side2', 'cartography_table_side3',
    'smithing_table_top', 'smithing_table_front', 'smithing_table_side', 'smithing_table_bottom',
    'blast_furnace_front', 'blast_furnace_side', 'blast_furnace_top',
    'fletching_table_top', 'fletching_table_front', 'fletching_table_side',
    'smoker_front', 'smoker_side', 'smoker_top', 'smoker_bottom', 'barrel_top', 'barrel_side', 'barrel_bottom',
    'loom_top', 'loom_front', 'loom_side', 'loom_bottom', 'composter_top', 'composter_side', 'composter_bottom',
    'lectern_top', 'lectern_front', 'lectern_sides', 'lectern_base', 'chiseled_bookshelf_occupied',
    // Aile dont le quota 5 h est épuisé : le Nether.
    'netherrack', 'nether_bricks', 'red_nether_bricks', 'polished_blackstone_bricks', 'blackstone', 'blackstone_top',
    'magma', 'lava_still', 'crimson_stem', 'crimson_stem_top', 'crimson_planks', 'nether_wart_block', 'crimson_nylium',
    'crimson_nylium_side', 'crimson_roots', 'crimson_fungus', 'nether_sprouts', 'soul_sand',
    // Aile dont le quota de la semaine est épuisé : l'End.
    'end_stone', 'end_stone_bricks', 'purpur_block', 'purpur_pillar', 'purpur_pillar_top', 'obsidian',
    'crying_obsidian', 'chorus_plant', 'chorus_flower', 'purple_wool', 'magenta_wool',
    // Avancement des tâches, contexte, coût, portails des quotas.
    'redstone_lamp', 'redstone_lamp_on', 'cobweb', 'emerald_block', 'nether_portal', 'end_portal_frame_top',
    'end_portal_frame_side', 'end_portal_frame_eye',
    // Saisons : neige, fleurs de printemps.
    'snow', 'grass_block_snow', 'azalea_leaves', 'flowering_azalea_leaves', 'allium', 'azure_bluet', 'blue_orchid',
    'pink_tulip',
    // Écran « Journée » : colonnes de blocs aux couleurs des comptes.
    'lapis_block', 'gold_block',
    // Paysage autour de la maison : montagnes, rivière, forêts.
    'water_still', 'sand', 'gravel', 'andesite', 'calcite', 'coarse_dirt', 'mossy_cobblestone', 'clay', 'ice', 'packed_ice',
    'spruce_leaves', 'birch_log', 'birch_log_top', 'birch_leaves', 'podzol_top', 'podzol_side', 'sugar_cane', 'lily_pad',
    'fern', 'tall_grass_bottom', 'tall_grass_top', 'pumpkin_side', 'pumpkin_top', 'sweet_berry_bush_stage3',
  ].map((name) => `block/${name}`),
  'item/diamond',
  // Animaux le jour, monstres la nuit.
  ...['pig/pig', 'cow/cow', 'sheep/sheep', 'sheep/sheep_fur', 'zombie/zombie', 'skeleton/skeleton', 'creeper/creeper',
    'spider/spider'].map((name) => `entity/${name}`),
  // Créatures du Nether et de l'End.
  ...['piglin/piglin', 'piglin/zombified_piglin', 'blaze', 'ghast/ghast', 'enderman/enderman', 'enderman/enderman_eyes']
    .map((name) => `entity/${name}`),
  'entity/chicken', 'entity/end_portal', 'environment/moon_phases',
  ...['kebab', 'aztec', 'alban', 'bomb', 'plant', 'wasteland', 'pool', 'courbet', 'sea', 'sunset', 'creebet']
    .map((name) => `painting/${name}`),
  'environment/sun',
  ...[
    'diamond_pickaxe', 'writable_book', 'book', 'spyglass', 'compass_00', 'emerald', 'paper', 'enchanted_book',
    'ender_eye', 'painting', 'redstone', 'stick', 'iron_sword', 'diamond_sword', 'bell', 'map', 'clock_00', 'goat_horn',
  ].map((name) => `item/${name}`),
  'entity/villager/villager',
  ...['plains', 'desert', 'jungle', 'savanna', 'snow', 'swamp', 'taiga'].map((name) => `entity/villager/type/${name}`),
  ...[
    'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian',
    'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith',
  ].map((name) => `entity/villager/profession/${name}`),
  ...['angry', 'heart', 'note'].map((name) => `particle/${name}`),
  // Barres de boss en haut de l'écran : les quotas de chaque compte, une couleur par compte.
  ...['blue', 'yellow', 'purple', 'white', 'pink'].flatMap((color) => [`${color}_background`, `${color}_progress`])
    .map((name) => `gui/sprites/boss_bar/${name}`),
  ...[
    'heart/full', 'heart/half', 'heart/container', 'food_full', 'food_half', 'food_empty',
    'experience_bar_background', 'experience_bar_progress',
  ].map((name) => `gui/sprites/hud/${name}`),
];

// Skins par défaut : des créateurs Minecraft connus (francophones). Le skin est celui du compte Minecraft qui porte ce
// pseudo. `--skins` en donne une autre liste.
const DEFAULT_PLAYERS = [
  'Siphano', 'Frigiel', 'aypierre', 'Fuze_III', 'Bob_Lennon', 'Zelvac', 'Skyyart', 'Squeezie', 'Inoxtag', 'Michou',
  'Gotaga', 'ZeratoR', 'Doigby', 'Locklear', 'Etoiles', 'Ponce', 'Kameto', 'Amixem', 'AntoineDaniel', 'Ninjaxx',
  'Zouloux', 'FuriousJumper', 'SuperFrog', 'Guep', 'MisterV', 'Cyprien', 'TiboInShape', 'Joyca', 'AmineMaTue',
  'Maghla', 'BagheraJones', 'Domingo', 'TheoRus', 'McFly', 'Carlito', 'Laink', 'Terracid',
];
// L'API Mojang répond par une page HTML quand on va trop vite : on espace les appels et on réessaie.
const MOJANG_DELAY_MS = 400;
const MOJANG_RETRY_MS = 4000;
const MOJANG_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mojangJson(url) {
  for (let attempt = 0; attempt < MOJANG_ATTEMPTS; attempt++) {
    const res = await fetch(url);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      await sleep(MOJANG_RETRY_MS);
      continue;
    }
    return res.ok ? JSON.parse(text) : null;
  }
  throw new Error('API Mojang indisponible');
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function fetchTextures() {
  const missing = [];
  await Promise.all([...new Set(TEXTURES)].map(async (name) => {
    try {
      await download(`${TEXTURES_BASE}${name}.png`, path.join(assetsDir, 'textures', `${name}.png`));
    } catch {
      missing.push(name);
    }
  }));
  console.log(`textures : ${TEXTURES.length - missing.length} ok${missing.length ? `, absentes : ${missing.join(', ')}` : ''}`);
}

async function fetchSkin(name) {
  const profile = await mojangJson(`https://api.mojang.com/users/profiles/minecraft/${name}`);
  if (!profile?.id) throw new Error('profil introuvable');
  const session = await mojangJson(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`);
  const property = session.properties?.find((p) => p.name === 'textures');
  const skin = JSON.parse(Buffer.from(property.value, 'base64').toString()).textures?.SKIN;
  if (!skin?.url) throw new Error('pas de skin');
  const file = `${profile.name}.png`;
  await download(skin.url, path.join(assetsDir, 'skins', file));
  return { name: profile.name, file, slim: skin.metadata?.model === 'slim' };
}

async function fetchSkins({ refresh, players }) {
  const indexFile = path.join(assetsDir, 'skins', 'index.json');
  const existing = await fs.readFile(indexFile, 'utf8').then(JSON.parse).catch(() => []);
  // L'API Mojang limite le débit : on ne refait les skins que sur demande.
  if (existing.length && !refresh) {
    console.log(`skins : ${existing.length} déjà présents (--refresh-skins pour les retélécharger)`);
    return;
  }
  const skins = [];
  for (const name of players) {
    try {
      skins.push(await fetchSkin(name));
    } catch (error) {
      console.log(`skin ${name} ignoré : ${error.message}`);
    }
    await sleep(MOJANG_DELAY_MS);
  }
  await fs.writeFile(indexFile, JSON.stringify(skins, null, 2));
  // Les skins d'une liste précédente ne servent plus.
  const kept = new Set([...skins.map((skin) => skin.file), 'index.json']);
  for (const file of await fs.readdir(path.join(assetsDir, 'skins'))) {
    if (!kept.has(file)) await fs.rm(path.join(assetsDir, 'skins', file));
  }
  console.log(`skins : ${skins.length}`);
}

/**
 * Vrai si les fichiers indispensables sont là (police, textures, au moins un skin).
 */
export async function assetsReady() {
  const exists = (file) => fs.stat(path.join(assetsDir, file)).then(() => true, () => false);
  return (await exists('fonts/Minecraft.otf')) && (await exists('textures/block/grass_block_top.png')) && (await exists('skins/index.json'));
}

export async function fetchAssets({ refreshSkins = false, players = DEFAULT_PLAYERS } = {}) {
  await download(FONT_URL, path.join(assetsDir, 'fonts', 'Minecraft.otf'));
  await fetchTextures();
  await fetchSkins({ refresh: refreshSkins || players !== DEFAULT_PLAYERS, players });
}

/**
 * Options de la ligne de commande : --refresh-skins, --skins a,b,c.
 */
export function assetOptions(args) {
  const skinsAt = args.indexOf('--skins');
  const players = skinsAt >= 0 ? (args[skinsAt + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean) : DEFAULT_PLAYERS;
  return { refreshSkins: args.includes('--refresh-skins'), players: players.length ? players : DEFAULT_PLAYERS };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await fetchAssets(assetOptions(process.argv.slice(2)));
}
