import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blockTexture, loadTexture, TEXTURE_ROOT, tintedTexture } from './textures.js';
import { BACK_WALL, BOOKSHELF_X, COBWEB_SPOTS, DOOR_X, EMERALD_SPOTS, ROOM_DEPTH, ROW_PITCH, STATIONS } from './layout.js';
import { hash } from './identity.js';
import { noise } from './noise.js';
import { buildTerrain, oakTree } from './terrain.js';
import { addWind } from './wind.js';
import { reducedMotion } from './motion.js';

const GRASS_TINT = '#91bd59';
const FOLIAGE_TINT = '#77ab2f';
const SPRUCE_TINT = '#619961';
const BIRCH_TINT = '#80a755';
const WATER = { tint: '#3f76e4', opacity: 0.8, level: -0.125, frameMs: 110 };
// Atmospheric perspective: the landscape around is slightly veiled in blue, so the house stands out.
const HAZE = '#d3dce8';
const FRAME_WIDTH = 0.14;

// Textures of each block. An entry [name, tint] designates a gray texture tinted according to the biome.
// `front` only applies to the face turned toward the camera (+z).
const BLOCKS = {
  grass: { top: ['grass_block_top', GRASS_TINT], side: 'grass_block_side', bottom: 'dirt' },
  dirt: { all: 'dirt' },
  stone: { all: 'stone' },
  planks: { all: 'oak_planks' },
  spruce: { all: 'spruce_planks' },
  birch: { all: 'birch_planks' },
  darkOak: { all: 'dark_oak_planks' },
  whiteConcrete: { all: 'white_concrete' },
  andesite: { all: 'polished_andesite' },
  smoothStone: { all: 'smooth_stone' },
  stoneBricks: { all: 'stone_bricks' },
  oakLog: { top: 'oak_log_top', side: 'oak_log' },
  glass: { all: 'glass', cutout: true },
  leaves: { all: ['oak_leaves', FOLIAGE_TINT], cutout: true, wind: 'leaves' },
  // Seasons: autumn foliage, flowering azaleas in spring, snow in winter.
  leavesOrange: { all: ['oak_leaves', '#d9761f'], cutout: true, wind: 'leaves' },
  leavesRed: { all: ['oak_leaves', '#b8361e'], cutout: true, wind: 'leaves' },
  leavesYellow: { all: ['oak_leaves', '#e0b02a'], cutout: true, wind: 'leaves' },
  floweringAzalea: { all: 'flowering_azalea_leaves', cutout: true, wind: 'leaves' },
  grassAutumn: { top: ['grass_block_top', '#b4ac5c'], side: 'grass_block_side', bottom: 'dirt' },
  snowyGrass: { top: 'snow', side: 'grass_block_snow', bottom: 'dirt' },
  snow: { all: 'snow' },
  seaLantern: { all: 'sea_lantern', glow: true },
  shroomlight: { all: 'shroomlight', glow: true },
  redWool: { all: 'red_wool' },
  lightBlueWool: { all: 'light_blue_wool' },
  blueWool: { all: 'blue_wool' },
  bricks: { all: 'bricks' },
  deepslateTiles: { all: 'deepslate_tiles' },
  orangeWool: { all: 'orange_wool' },
  bookshelf: { top: 'oak_planks', side: 'bookshelf' },
  crafting: { top: 'crafting_table_top', front: 'crafting_table_front', side: 'crafting_table_side', bottom: 'oak_planks' },
  cartography: { top: 'cartography_table_top', front: 'cartography_table_side3', side: 'cartography_table_side1', bottom: 'dark_oak_planks' },
  furnace: { top: 'furnace_top', front: 'furnace_front', side: 'furnace_side' },
  furnaceOn: { top: 'furnace_top', front: 'furnace_front_on', side: 'furnace_side', glow: true },
  smithing: { top: 'smithing_table_top', front: 'smithing_table_front', side: 'smithing_table_side', bottom: 'smithing_table_bottom' },
  blastFurnace: { top: 'blast_furnace_top', front: 'blast_furnace_front', side: 'blast_furnace_side' },
  fletching: { top: 'fletching_table_top', front: 'fletching_table_front', side: 'fletching_table_side', bottom: 'birch_planks' },
  smoker: { top: 'smoker_top', front: 'smoker_front', side: 'smoker_side', bottom: 'smoker_bottom' },
  barrel: { top: 'barrel_top', side: 'barrel_side', bottom: 'barrel_bottom' },
  loom: { top: 'loom_top', front: 'loom_front', side: 'loom_side', bottom: 'loom_bottom' },
  composter: { top: 'composter_top', side: 'composter_side', bottom: 'composter_bottom' },
  lectern: { top: 'lectern_top', front: 'lectern_front', side: 'lectern_sides', bottom: 'lectern_base' },
  hay: { top: 'hay_block_top', side: 'hay_block_side' },
  netherrack: { all: 'netherrack' },
  netherBricks: { all: 'nether_bricks' },
  redNetherBricks: { all: 'red_nether_bricks' },
  blackstoneBricks: { all: 'polished_blackstone_bricks' },
  blackstone: { top: 'blackstone_top', side: 'blackstone' },
  magma: { all: 'magma', glow: true },
  lava: { all: 'lava_still', glow: true },
  glowstone: { all: 'glowstone', glow: true },
  crimsonStem: { top: 'crimson_stem_top', side: 'crimson_stem' },
  netherWart: { all: 'nether_wart_block' },
  crimsonNylium: { top: 'crimson_nylium', side: 'crimson_nylium_side', bottom: 'netherrack' },
  soulSand: { all: 'soul_sand' },
  endStone: { all: 'end_stone' },
  endStoneBricks: { all: 'end_stone_bricks' },
  purpur: { all: 'purpur_block' },
  purpurPillar: { top: 'purpur_pillar_top', side: 'purpur_pillar' },
  obsidian: { all: 'obsidian' },
  cryingObsidian: { all: 'crying_obsidian', glow: true },
  chorusPlant: { all: 'chorus_plant' },
  chorusFlower: { all: 'chorus_flower' },
  purpleWool: { all: 'purple_wool' },
  redstoneLamp: { all: 'redstone_lamp' },
  redstoneLampOn: { all: 'redstone_lamp_on', glow: true },
  emeraldBlock: { all: 'emerald_block' },
  endPortalFrame: { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone' },
  // Landscape around the house.
  sand: { all: 'sand' },
  cobblestone: { all: 'cobblestone' },
  gravel: { all: 'gravel' },
  clay: { all: 'clay' },
  rawAndesite: { all: 'andesite' },
  coarseDirt: { all: 'coarse_dirt' },
  podzol: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' },
  pumpkin: { top: 'pumpkin_top', side: 'pumpkin_side' },
  spruceLog: { top: 'oak_log_top', side: 'spruce_log' },
  spruceLeaves: { all: ['spruce_leaves', SPRUCE_TINT], cutout: true, wind: 'leaves' },
  birchLog: { top: 'birch_log_top', side: 'birch_log' },
  birchLeaves: { all: ['birch_leaves', BIRCH_TINT], cutout: true, wind: 'leaves' },
  birchLeavesAutumn: { all: ['birch_leaves', '#e0b02a'], cutout: true, wind: 'leaves' },
  lilyPad: { all: ['lily_pad', '#208030'], cutout: true },
  path: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' },
};

// One wing per account, each clearly distinct, in the order of the accounts: concrete and stone office with cold light,
// wood and log house with warm light, brick workshop, birch and slate pavilion.
const WING_STYLES = [
  { floor: 'andesite', corridor: 'smoothStone', wall: 'whiteConcrete', lowWall: 'stoneBricks', pillar: 'stoneBricks', lamp: 'seaLantern', rug: 'lightBlueWool', chair: 'birch_planks', light: '#d4ecff' },
  { floor: 'planks', corridor: 'spruce', wall: 'planks', lowWall: 'planks', pillar: 'oakLog', lamp: 'shroomlight', rug: 'orangeWool', chair: 'spruce_planks', light: '#ffb070' },
  { floor: 'darkOak', corridor: 'smoothStone', wall: 'bricks', lowWall: 'bricks', pillar: 'stoneBricks', lamp: 'glowstone', rug: 'redWool', chair: 'dark_oak_planks', light: '#ffd29a' },
  { floor: 'birch', corridor: 'andesite', wall: 'birch', lowWall: 'deepslateTiles', pillar: 'deepslateTiles', lamp: 'seaLantern', rug: 'blueWool', chair: 'birch_planks', light: '#e2f0ff' },
];
// Wing of an account out of quota: the Nether (5 h) or the End (week) replaces its materials.
const THEME_STYLES = {
  nether: { floor: 'blackstoneBricks', corridor: 'netherrack', wall: 'redNetherBricks', lowWall: 'netherBricks', pillar: 'blackstone', lamp: 'glowstone', rug: 'magma', chair: 'crimson_planks', light: '#ff5a26' },
  end: { floor: 'endStoneBricks', corridor: 'endStone', wall: 'purpur', lowWall: 'obsidian', pillar: 'purpurPillar', lamp: 'cryingObsidian', rug: 'purpleWool', chair: 'purpur_block', light: '#c27bff' },
};
// Lamp of each room: strong enough for the room to stay readable at dusk, in the rain, at night.
const ROOM_LIGHT = { intensity: 3, distance: 12, decay: 1.2, height: 2.6 };
// Glow of a lit portal: purple for the Nether, teal for the End.
const PORTAL_LIGHT = { nether: '#b45cff', end: '#4dffd2', intensity: 3.2, distance: 9, decay: 1.2 };
// Ambient light above a Nether or End zone, to tint all of it.
const ZONE_LIGHT = { height: 8, intensity: 2.4, decay: 0.7, reach: 1.3 };

const PLANTS = {
  grass: ['short_grass', GRASS_TINT],
  poppy: 'poppy',
  dandelion: 'dandelion',
  cornflower: 'cornflower',
  daisy: 'oxeye_daisy',
  crimsonRoots: 'crimson_roots',
  crimsonFungus: 'crimson_fungus',
  netherSprouts: 'nether_sprouts',
  cobweb: 'cobweb',
  grassAutumn: ['short_grass', '#b4ac5c'],
  allium: 'allium',
  azureBluet: 'azure_bluet',
  blueOrchid: 'blue_orchid',
  pinkTulip: 'pink_tulip',
  fern: ['fern', GRASS_TINT],
  sugarCane: 'sugar_cane',
  berryBush: 'sweet_berry_bush_stage3',
};
// Wind sway: grass and flowers move noticeably, foliage barely.
const WIND_SETTINGS = { plant: { sway: 0.22, anchor: 0 }, leaves: { sway: 0.05, anchor: -0.5 } };
const WINDY_PLANTS = new Set(['grass', 'grassAutumn', 'poppy', 'dandelion', 'cornflower', 'daisy', 'allium', 'azureBluet', 'blueOrchid', 'pinkTulip', 'crimsonRoots', 'netherSprouts', 'fern', 'berryBush']);
// Room lamps light up more at night.
// Lamps turn on as soon as the dimness passes this threshold, and shine brighter and brighter until night.
const LIGHTS_ON_GLOOM = 0.12;
const LIGHT_GAIN = { base: 0.6, gloom: 1.7 };
// Cost shown in emerald blocks, on a logarithmic scale: $1, $3, $7, $15... up to 8 blocks.
const EMERALD_LEVELS = 8;
// Cobwebs according to how full the context is.
const COBWEB_THRESHOLDS = [60, 75, 85, 95];
// One redstone lamp per task cell; the one for the current task blinks.
const LAMP_BLINK_MS = 600;
const FLOWERS = ['poppy', 'dandelion', 'cornflower', 'daisy'];

// Normal garden and landscape by season: ground, density and choice of flowers (foliage in terrain.js).
const SEASON_GROUNDS = {
  spring: { top: 'grass', flowers: [...FLOWERS, 'allium', 'azureBluet', 'blueOrchid', 'pinkTulip'], flowerRate: 0.16, meadowRate: 0.6, grass: 'grass' },
  summer: { top: 'grass', flowers: FLOWERS, flowerRate: 0.06, grass: 'grass' },
  autumn: { top: 'grassAutumn', flowers: ['dandelion'], flowerRate: 0.02, grass: 'grassAutumn' },
  winter: { top: 'snowyGrass', flowers: [], flowerRate: 0, grass: null },
};

// Ground, plants and trees of the garden for each theme (the normal theme follows the season).
const GROUNDS = {
  normal: { top: 'grass', flowers: FLOWERS, grass: 'grass', tree: oakTree },
  nether: { top: 'netherrack', patch: 'crimsonNylium', flowers: ['crimsonFungus', 'crimsonRoots'], grass: 'netherSprouts', tree: fungusTree, pool: 'lava' },
  end: { top: 'endStone', flowers: [], grass: null, tree: chorusTree },
};

const materialCache = new Map();

function material(texture, { cutout = false, glow = false, wind = null, haze = false } = {}) {
  const key = `${Array.isArray(texture) ? texture.join(':') : texture}:${cutout}:${glow}:${wind}:${haze}`;
  if (!materialCache.has(key)) {
    const options = cutout ? { alphaTest: 0.5, side: THREE.DoubleSide } : {};
    if (haze) options.color = HAZE;
    // Glowing blocks (lanterns, lit furnace) shine even in shadow.
    if (glow) Object.assign(options, { emissive: 0xffffff, emissiveIntensity: 1 });
    const mat = new THREE.MeshLambertMaterial(options);
    if (wind) addWind(mat, WIND_SETTINGS[wind]);
    const loading = Array.isArray(texture) ? tintedTexture(...texture)
      : texture.includes('/') ? loadTexture(`${TEXTURE_ROOT}${texture}.png`) : blockTexture(texture);
    loading.then((map) => {
      mat.map = map;
      if (glow) mat.emissiveMap = map;
      mat.needsUpdate = true;
    });
    materialCache.set(key, mat);
  }
  return materialCache.get(key);
}

// Order of the faces of a BoxGeometry: +x, -x, +y, -y, +z, -z.
function blockMaterials({ all, top = all, bottom, side = all, front = side, cutout = false, glow = false, wind = null }, haze = false) {
  return [side, side, top, bottom ?? top, front, side].map((texture) => material(texture, { cutout, glow, wind, haze }));
}

function shadowed(object, cast = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = true;
    }
  });
  return object;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const carpetBox = new THREE.BoxGeometry(1, 1 / 16, 1);

// One block geometry per texture set: faces sharing a texture form a single group, hence a
// single draw call (stone: 1 instead of 6; grass: 3).
const shapeCache = new Map();
function blockShape(spec, haze = false, base = unitBox) {
  const faces = blockMaterials(spec, haze);
  const materials = [...new Set(faces)];
  const key = `${base.uuid}|${faces.map((face) => face.uuid).join()}`;
  if (!shapeCache.has(key)) {
    // Faces of a BoxGeometry: 6 indices each, in the order of blockMaterials.
    const source = base.index.array;
    const index = [];
    const geometry = base.clone();
    geometry.clearGroups();
    materials.forEach((mat, group) => {
      const start = index.length;
      faces.forEach((face, side) => {
        if (face === mat) index.push(...source.slice(side * 6, side * 6 + 6));
      });
      geometry.addGroup(start, index.length - start, group);
    });
    geometry.setIndex(index);
    shapeCache.set(key, geometry);
  }
  return { geometry: shapeCache.get(key), materials };
}

function blockMesh(spec) {
  const { geometry, materials } = blockShape(spec);
  return new THREE.Mesh(geometry, materials);
}

/**
 * Row of identical objects whose first N are in one state (lit, placed, visible) and the rest in
 * the other, or hidden if `off` is absent: two instanced meshes instead of one mesh per object.
 */
class Prefix {
  constructor(group, geometry, positions, on, off = null, castShadow = false) {
    this.positions = positions;
    this.size = positions.length;
    this.count = -1;
    const instances = (mat) => {
      const mesh = new THREE.InstancedMesh(geometry, mat, positions.length);
      positions.forEach((position, index) => mesh.setMatrixAt(index, new THREE.Matrix4().setPosition(position)));
      mesh.count = 0;
      // A translucent state (ghost block of the portal) casts no shadow.
      mesh.castShadow = castShadow && ![mat].flat().some((each) => each.transparent);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    this.on = instances(on);
    this.off = off && instances(off);
    this.set(0);
  }

  set(count) {
    if (count === this.count) return;
    this.count = count;
    this.on.count = count;
    if (!this.off) return;
    this.positions.slice(count).forEach((position, index) => this.off.setMatrixAt(index, new THREE.Matrix4().setPosition(position)));
    this.off.count = this.size - count;
    this.off.instanceMatrix.needsUpdate = true;
  }
}
const waterQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function crossGeometry() {
  const a = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 4);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 4);
  const positions = [...a.attributes.position.array, ...b.attributes.position.array];
  // Normals pointing up: plants are lit like the ground, with no dark side.
  const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...a.attributes.uv.array, ...b.attributes.uv.array], 2));
  geometry.setIndex([...a.index.array, ...b.index.array.map((i) => i + 4)]);
  return geometry.translate(0, 0.5, 0);
}
const cross = crossGeometry();

/**
 * Accumulates blocks by type then draws them as InstancedMesh (one render call per type).
 */
class Blocks {
  // The landscape around the house casts no shadow: its shadow camera only covers the house.
  constructor({ castShadow = true, frozen = false, haze = false } = {}) {
    this.castShadow = castShadow;
    this.frozen = frozen;
    this.haze = haze;
    this.cells = new Map();
    this.carpets = [];
    this.plants = [];
    this.water = [];
  }

  set(type, x, y, z) {
    this.cells.set(`${x},${y},${z}`, { type, x, y, z });
  }

  clear(x, y, z) {
    this.cells.delete(`${x},${y},${z}`);
  }

  box(type, x0, x1, y0, y1, z0, z1) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(type, x, y, z);
  }

  meshes() {
    const matrix = new THREE.Matrix4();
    const instanced = (geometry, materials, items, place, castShadow) => {
      const mesh = new THREE.InstancedMesh(geometry, materials, items.length);
      items.forEach((item, index) => mesh.setMatrixAt(index, place(item, matrix)));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      return mesh;
    };
    const byKey = (items, key) => {
      const groups = new Map();
      for (const item of items) {
        if (!groups.has(item[key])) groups.set(item[key], []);
        groups.get(item[key]).push(item);
      }
      return groups;
    };
    return [
      // The ground (below y = 0) casts a shadow on nothing: it stays out of the shadow pass.
      ...[...byKey([...this.cells.values()].map((cell) => ({ ...cell, key: `${cell.type}|${cell.y < 0}` })), 'key')].map(([, cells]) => {
        const { geometry, materials } = blockShape(BLOCKS[cells[0].type], this.haze);
        return instanced(geometry, materials, cells, ({ x, y, z }, m) => m.makeTranslation(x + 0.5, y + 0.5, z + 0.5), this.castShadow && cells[0].y >= 0);
      }),
      ...[...byKey(this.carpets, 'type')].map(([type, cells]) => {
        const { geometry, materials } = blockShape(BLOCKS[type], this.haze, carpetBox);
        return instanced(geometry, materials, cells, ({ x, y, z }, m) => m.makeTranslation(x + 0.5, y + 1 / 32, z + 0.5), false);
      }),
      ...[...byKey(this.plants, 'type')].map(([type, cells]) => instanced(cross, material(PLANTS[type], { cutout: true, wind: WINDY_PLANTS.has(type) ? 'plant' : null, haze: this.haze }), cells,
        ({ x, y, z, scale = 1 }, m) => m.makeScale(scale, scale, scale).setPosition(x + 0.5, y, z + 0.5), false)),
      ...(this.water.length ? [instanced(waterQuad, waterMaterial(this.frozen), this.water,
        ({ x, z }, m) => m.makeTranslation(x + 0.5, WATER.level, z + 0.5), false)] : []),
    ];
  }
}

// Water texture, whose frames World.animate scrolls through.
let waterMap = null;

/**
 * River water: animated Minecraft texture, tinted blue, translucent; frozen in winter.
 */
function waterMaterial(frozen) {
  const mat = new THREE.MeshLambertMaterial({ color: frozen ? '#ffffff' : WATER.tint, transparent: true, opacity: frozen ? 0.92 : WATER.opacity, depthWrite: false });
  blockTexture(frozen ? 'ice' : 'water_still').then((map) => {
    if (!frozen) waterMap = map;
    mat.map = map;
    mat.needsUpdate = true;
  });
  return mat;
}

function chair(x, z, texture) {
  // Seat, and backrest to the north: one sits there facing the camera.
  const seat = new THREE.BoxGeometry(1, 0.5, 1).translate(0.5, 0.25, 0.5);
  const back = new THREE.BoxGeometry(1, 0.5, 0.5).translate(0.5, 0.75, 0.25);
  const mesh = new THREE.Mesh(mergeGeometries([seat, back]), material(texture));
  mesh.position.set(x, 0, z);
  return shadowed(mesh);
}

function flowerPot(blocks, group, x, z, flower) {
  const pot = new THREE.Mesh(new THREE.BoxGeometry(6 / 16, 6 / 16, 6 / 16), material('flower_pot'));
  pot.position.set(x + 0.5, 3 / 16, z + 0.5);
  group.add(shadowed(pot));
  blocks.plants.push({ type: flower, x, y: 4 / 16, z, scale: 0.7 });
}

/**
 * Floor trim along the inner perimeter of the room, in the color of the session's state.
 */
function statusFrame(room) {
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true });
  const sides = [
    [room.width, FRAME_WIDTH, room.width / 2, FRAME_WIDTH / 2],
    [room.width, FRAME_WIDTH, room.width / 2, ROOM_DEPTH - FRAME_WIDTH / 2],
    [FRAME_WIDTH, ROOM_DEPTH, FRAME_WIDTH / 2, ROOM_DEPTH / 2],
    [FRAME_WIDTH, ROOM_DEPTH, room.width - FRAME_WIDTH / 2, ROOM_DEPTH / 2],
  ];
  const strips = sides.map(([w, d, cx, cz]) => new THREE.BoxGeometry(w, 0.04, d).translate(room.x0 + cx, 0.03, room.z0 + cz));
  const frame = new THREE.Mesh(mergeGeometries(strips), mat);
  frame.userData.material = mat;
  return frame;
}

/**
 * Giant crimson fungus of the Nether: stem, wart cap, shroomlights underneath.
 */
function fungusTree(blocks, x, z, trunk) {
  blocks.box('crimsonStem', x, x, 0, trunk - 1, z, z);
  for (let i = -2; i <= 2; i++) {
    for (let k = -2; k <= 2; k++) {
      if (Math.abs(i) === 2 && Math.abs(k) === 2) continue;
      blocks.set('netherWart', x + i, trunk, z + k);
      if (Math.abs(i) <= 1 && Math.abs(k) <= 1) blocks.set('netherWart', x + i, trunk + 1, z + k);
      else if (noise(x + i, z + k, 4) < 0.35) blocks.set('netherWart', x + i, trunk - 1, z + k);
    }
  }
  blocks.set('shroomlight', x + 1, trunk - 1, z);
  blocks.set('shroomlight', x - 1, trunk - 1, z + 1);
}

/**
 * End chorus plant: a stem that branches out, a flower at the tip.
 */
function chorusTree(blocks, x, z, trunk) {
  blocks.box('chorusPlant', x, x, 0, trunk - 1, z, z);
  const side = noise(x, z, 5) < 0.5 ? 1 : -1;
  blocks.box('chorusPlant', x + side, x + side, 2, trunk - 2, z, z);
  blocks.set('chorusFlower', x, trunk, z);
  blocks.set('chorusFlower', x + side, trunk - 1, z);
  if (trunk > 4) blocks.set('chorusPlant', x, 3, z + side);
}

function furnishRoom(blocks, group, room, style, roomObjects) {
  const { x0, z0, width } = room;
  const seed = hash(room.key);
  if (!room.player) {
    // Wing without a session: an unlit storeroom.
    blocks.box('barrel', x0, x0 + 1, 0, 0, z0, z0);
    blocks.set('barrel', x0, 1, z0);
    blocks.set('hay', x0 + width - 1, 0, z0 + ROOM_DEPTH - 1);
    flowerPot(blocks, group, x0 + 4, z0 + 2, FLOWERS[seed % FLOWERS.length]);
    return;
  }
  for (const bx of BOOKSHELF_X) blocks.box('bookshelf', x0 + bx, x0 + bx, 0, 1, z0, z0);
  for (let dx = 1; dx <= 5; dx++) for (let dz = 3; dz <= 4; dz++) blocks.carpets.push({ type: style.rug, x: x0 + dx, y: 0, z: z0 + dz });
  const at = (station) => [x0 + STATIONS[station].block[0], z0 + STATIONS[station].block[1]];
  const [cartoX, cartoZ] = at('carto');
  blocks.set('cartography', cartoX, 0, cartoZ);
  const [craftX, craftZ] = at('craft');
  blocks.set('crafting', craftX, 0, craftZ);
  const [furnaceX, furnaceZ] = at('furnace');
  const furnace = shadowed(blockMesh(BLOCKS.furnace));
  furnace.position.set(furnaceX + 0.5, 0.5, furnaceZ + 0.5);
  group.add(furnace);
  const [chairX, chairZ] = at('chair');
  group.add(chair(chairX, chairZ, style.chair));
  flowerPot(blocks, group, x0, z0 + ROOM_DEPTH - 1, FLOWERS[seed % FLOWERS.length]);
  const emerald = blockShape(BLOCKS.emeraldBlock);
  const emeralds = new Prefix(group, emerald.geometry, [0, 1].flatMap((level) => EMERALD_SPOTS.map(([dx, dz]) => (
    new THREE.Vector3(x0 + dx + 0.5, level + 0.5, z0 + dz + 0.5)))), emerald.materials, null, true);
  const cobwebs = new Prefix(group, cross, COBWEB_SPOTS.map(([dx, dz]) => (
    new THREE.Vector3(x0 + (dx < 0 ? width + dx : dx) + 0.5, 0, z0 + dz + 0.5))), material(PLANTS.cobweb, { cutout: true }));
  // Redstone lamps in the back wall, in place of the window, when the session follows a task list.
  let lamps = null;
  if (room.player.tasks?.total) {
    const spots = [];
    for (let dx = 2; dx <= width - 3; dx++) {
      blocks.clear(x0 + dx, BACK_WALL - 1, z0 - 1);
      spots.push(new THREE.Vector3(x0 + dx + 0.5, BACK_WALL - 0.5, z0 - 0.5));
    }
    const off = blockShape(BLOCKS.redstoneLamp);
    lamps = new Prefix(group, off.geometry, spots, blockShape(BLOCKS.redstoneLampOn).materials, off.materials, true);
  }
  for (const villager of room.villagers) {
    if (villager.block) blocks.set(villager.block, x0 + villager.slot.block[0], 0, z0 + villager.slot.block[1]);
  }
  const light = new THREE.PointLight(style.light, ROOM_LIGHT.intensity, ROOM_LIGHT.distance, ROOM_LIGHT.decay);
  light.position.set(x0 + width / 2, ROOM_LIGHT.height, z0 + ROOM_DEPTH / 2);
  group.add(light);
  light.userData.baseIntensity = ROOM_LIGHT.intensity;
  const frame = statusFrame(room);
  group.add(frame);
  roomObjects.set(room.player.id, {
    furnace,
    frame,
    light,
    emeralds,
    cobwebs,
    lamps,
    stations: {
      craft: [craftX + 0.5, 1.05, craftZ + 0.5],
      carto: [cartoX + 0.5, 1.05, cartoZ + 0.5],
      furnace: [furnaceX + 0.5, 0.75, furnaceZ + 1.05],
      library: [x0 + 1, 1.8, z0 + 0.6],
    },
  });
}

/**
 * A row of rooms: floor, tall back wall (windows, lamps), tall west wall, and on the camera side
 * one-block low walls so one can see inside. In front, an aisle.
 */
function buildRow(blocks, group, row, style, roomObjects) {
  const front = row.z0 + ROOM_DEPTH;
  for (let x = row.x0; x <= row.x1; x++) {
    for (let z = row.back; z <= front + ROW_PITCH - ROOM_DEPTH - 2; z++) blocks.set(style.corridor, x, -1, z);
    blocks.box(style.wall, x, x, 0, BACK_WALL - 1, row.back, row.back);
    blocks.set(style.lowWall, x, 0, front);
  }
  blocks.box(style.pillar, row.x0, row.x0, 0, BACK_WALL - 1, row.back, front);
  blocks.box(style.pillar, row.x0, row.x0, BACK_WALL, BACK_WALL, row.back, row.back);
  // Windows and lamps in the back wall, on the top row when there are only two.
  for (let z = row.back; z <= front; z++) blocks.set(style.pillar, row.x1, 0, z);
  for (const room of row.rooms) {
    const { x0, z0, width } = room;
    for (let x = x0; x < x0 + width; x++) for (let z = z0; z < front; z++) blocks.set(style.floor, x, -1, z);
    // Tall post at each partition of the back wall, low partition down to the front low wall.
    blocks.box(style.pillar, x0 + width, x0 + width, 0, BACK_WALL, row.back, row.back);
    for (let z = z0; z <= front; z++) blocks.set(style.pillar, x0 + width, 0, z);
    for (const dx of DOOR_X) blocks.clear(x0 + dx, 0, front);
    // Window behind the counter (or task lamps, placed with the furniture), recessed lamps on either side.
    const top = BACK_WALL - 1;
    if (!room.player?.tasks?.total) for (let dx = 2; dx <= Math.min(5, width - 3); dx++) blocks.set('glass', x0 + dx, top, row.back);
    if (room.player) {
      blocks.set(style.lamp, x0 + 1, top, row.back);
      blocks.set(style.lamp, x0 + width - 2, top, row.back);
    }
    furnishRoom(blocks, group, room, style, roomObjects);
  }
}

function buildGarden(blocks, group, layout, season) {
  const { bounds } = layout;
  const themeAt = (x) => layout.wings.find((wing) => x >= wing.zone.x0 && x <= wing.zone.x1)?.theme ?? 'normal';
  const seasonal = SEASON_GROUNDS[season];
  const groundAt = (x) => (themeAt(x) === 'normal' ? { ...GROUNDS.normal, ...seasonal } : GROUNDS[themeAt(x)]);
  // Cells occupied by the house or by a portal corner: no flowers or hay on them.
  const inHouse = (x, z) => layout.wings.some((wing) => wing.rows.some((row) => x >= row.x0 && x <= row.x1
    && z >= row.back && z < row.back + ROW_PITCH)
    || (wing.portals && x >= wing.portals.x0 && x <= wing.portals.x0 + 6 && z >= 0 && z <= 9));
  for (let x = bounds.x0; x <= bounds.x1; x++) {
    const ground = groundAt(x);
    for (let z = bounds.z0; z <= bounds.z1; z++) {
      blocks.set(ground.patch && noise(Math.floor(x / 3), Math.floor(z / 3), 11) < 0.35 ? ground.patch : ground.top, x, -1, z);
      if (inHouse(x, z)) continue;
      const roll = noise(x, z, 7);
      // In spring, flowering meadows in patches, clearly visible from afar.
      const meadow = ground.meadowRate && noise(Math.floor(x / 4), Math.floor(z / 4), 13) < 0.3;
      const flowerRate = meadow ? ground.meadowRate : ground.flowerRate ?? 0.06;
      if (roll < flowerRate && ground.flowers.length) {
        blocks.plants.push({ type: ground.flowers[Math.floor(noise(x, z, 8) * ground.flowers.length)], x, y: 0, z });
      } else if (roll < flowerRate + 0.2 && ground.grass) {
        blocks.plants.push({ type: ground.grass, x, y: 0, z });
      } else if (roll > 0.992 && z > layout.depth && themeAt(x) === 'normal') {
        blocks.set('hay', x, 0, z);
      }
    }
  }
  // Aisle between the wings, with a red carpet.
  for (let i = 0; i < layout.wings.length - 1; i++) {
    const x0 = layout.wings[i].x1 + 1;
    for (let x = x0; x < x0 + layout.hall; x++) {
      for (let z = 0; z < layout.depth; z++) {
        blocks.set('darkOak', x, -1, z);
        if (x === x0 + Math.floor(layout.hall / 2)) blocks.carpets.push({ type: 'redWool', x, y: 0, z });
      }
    }
  }
  // Trees behind the house only: in front or on the sides, they would hide the rooms and the portals.
  for (let x = bounds.x0 + 1; x <= bounds.x1 - 1; x += 6) {
    const tx = x + Math.floor(noise(x, 3) * 2);
    groundAt(tx).tree(blocks, tx, bounds.z0 + 1, 4 + (x % 2), season);
  }
  for (const wing of layout.wings) {
    if (wing.theme === 'nether') {
      // Lava pools in the garden, in front of and behind the house.
      for (const [px, pz] of [[wing.zone.x0 + 2, bounds.z1 - 1], [wing.zone.x1 - 3, bounds.z0 + 3]]) {
        if (inHouse(px, pz) || inHouse(px + 1, pz)) continue;
        blocks.box('lava', px, px + 1, -1, -1, pz, pz);
      }
    } else if (wing.theme === 'end') {
      // Obsidian pillars, like on the Ender Dragon's island.
      for (const px of [wing.zone.x0 + 2, wing.zone.x1 - 2]) blocks.box('obsidian', px, px, 0, 4, bounds.z0 + 3, bounds.z0 + 3);
    }
    if (wing.theme !== 'normal') {
      const width = wing.zone.x1 - wing.zone.x0 + 1;
      const light = new THREE.PointLight(THEME_STYLES[wing.theme].light, ZONE_LIGHT.intensity, width * ZONE_LIGHT.reach, ZONE_LIGHT.decay);
      light.userData.baseIntensity = ZONE_LIGHT.intensity;
      light.position.set((wing.zone.x0 + wing.zone.x1 + 1) / 2, ZONE_LIGHT.height, layout.depth / 2);
      group.add(light);
    }
  }
}

const NETHER_FRAME = [[1, 0], [2, 0], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3], [1, 4], [2, 4]];
const END_FRAME = [[1, 0], [2, 0], [3, 0], [4, 1], [4, 2], [4, 3], [3, 4], [2, 4], [1, 4], [0, 3], [0, 2], [0, 1]];
const ghostMaterial = new THREE.MeshLambertMaterial({ color: '#2a1f3d', transparent: true, opacity: 0.22, depthWrite: false });

function animatedPlane(width, height, textureName, opacity) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  loadTexture(`${TEXTURE_ROOT}${textureName}.png`).then((map) => {
    // Animation texture (stacked frames): we scroll it ourselves, frame by frame.
    const frames = map.image.height / map.image.width;
    map.repeat.set(1, 1 / Math.max(1, frames));
    map.wrapT = THREE.RepeatWrapping;
    map.wrapS = THREE.RepeatWrapping;
    map.userData.frames = frames;
    map.needsUpdate = true;
    mat.map = map;
    mat.needsUpdate = true;
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

/**
 * Portals of a wing: the Nether frame is built with the 5 h quota (one block per 10 % step),
 * the End frame receives an eye per twelfth of the weekly quota. At 100 %, the portal lights up.
 */
function buildPortals(blocks, group, wing) {
  const x0 = wing.portals.x0;
  const netherZ = 1;
  const obsidian = blockShape(BLOCKS.obsidian);
  const nether = new Prefix(group, obsidian.geometry, NETHER_FRAME.map(([dx, dy]) => new THREE.Vector3(x0 + 1 + dx + 0.5, dy + 0.5, netherZ + 0.5)),
    obsidian.materials, ghostMaterial, true);
  for (const [dx, dy] of [[0, 0], [3, 0], [0, 4], [3, 4]]) blocks.set('obsidian', x0 + 1 + dx, dy, netherZ);
  const netherPortal = animatedPlane(2, 3, 'block/nether_portal', 0.85);
  netherPortal.position.set(x0 + 3, 2.5, netherZ + 0.5);
  netherPortal.visible = false;
  group.add(netherPortal);
  const endZ = netherZ + 3;
  blocks.box('stoneBricks', x0 + 1, x0 + 5, 0, 0, endZ, endZ + 4);
  for (const [dx, dz] of END_FRAME) blocks.set('endPortalFrame', x0 + 1 + dx, 1, endZ + dz);
  const eyes = new Prefix(group, new THREE.BoxGeometry(0.5, 0.2, 0.5), END_FRAME.map(([dx, dz]) => new THREE.Vector3(x0 + 1 + dx + 0.5, 2.1, endZ + dz + 0.5)),
    material('end_portal_frame_eye'));
  const endPortal = animatedPlane(3, 3, 'entity/end_portal', 1);
  endPortal.rotation.x = -Math.PI / 2;
  endPortal.position.set(x0 + 3.5, 1.75, endZ + 2.5);
  endPortal.visible = false;
  group.add(endPortal);
  return {
    nether,
    netherPortal,
    eyes,
    endPortal,
    netherLight: portalLight(group, 'nether', x0 + 3, 2.5, netherZ + 1.2),
    endLight: portalLight(group, 'end', x0 + 3.5, 2.4, endZ + 2.5),
  };
}

function portalLight(group, kind, x, y, z) {
  const light = new THREE.PointLight(PORTAL_LIGHT[kind], PORTAL_LIGHT.intensity, PORTAL_LIGHT.distance, PORTAL_LIGHT.decay);
  light.position.set(x, y, z);
  light.userData.baseIntensity = PORTAL_LIGHT.intensity;
  light.userData.active = false;
  group.add(light);
  return light;
}

/**
 * The scenery: island, garden, two-wing house and furniture, rebuilt only when the plan changes.
 */
export class World {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.signature = null;
    this.rooms = new Map();
    this.portals = new Map();
  }

  build(layout, season = 'summer', scenery = null) {
    const cover = scenery?.cover;
    const signature = `${layout.signature}|${season}|${cover ? [cover.x0, cover.x1, cover.z0, cover.z1, scenery.skyKey].join(',') : ''}`;
    if (signature === this.signature) return false;
    this.signature = signature;
    this.season = season;
    this.release();
    this.rooms = new Map();
    this.portals = new Map();
    const blocks = new Blocks();
    const extras = new THREE.Group();
    buildGarden(blocks, extras, layout, season);
    for (const wing of layout.wings) {
      const style = THEME_STYLES[wing.theme] ?? WING_STYLES[(wing.account.slot ?? 0) % WING_STYLES.length];
      for (const row of wing.rows) buildRow(blocks, extras, row, style, this.rooms);
      if (wing.portals) this.portals.set(wing.account.id, buildPortals(blocks, extras, wing));
    }
    this.group.add(...blocks.meshes(), extras);
    if (scenery) {
      const land = new Blocks({ castShadow: false, frozen: season === 'winter', haze: true });
      buildTerrain(land, { flat: layout.bounds, ...scenery }, season, SEASON_GROUNDS[season]);
      this.group.add(...land.meshes());
    }
    return true;
  }

  /**
   * Frees what was created for the old plan (geometries and materials specific to rooms, instances); what is
   * shared through the cache stays. Without this, a page left open all day accumulates graphics memory.
   */
  release() {
    const shared = new Set([unitBox, carpetBox, waterQuad, cross, ghostMaterial, ...shapeCache.values(), ...materialCache.values()]);
    this.group.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry && !shared.has(object.geometry)) object.geometry.dispose();
      for (const mat of [object.material ?? []].flat()) if (!shared.has(mat)) mat.dispose();
    });
    this.group.clear();
  }

  /**
   * Rippling water: we scroll through the frames of its animated texture.
   */
  animate(time) {
    if (!waterMap || reducedMotion()) return;
    const frames = waterMap.image.height / waterMap.image.width;
    waterMap.offset.y = 1 - ((Math.floor(time / WATER.frameMs) % frames) + 1) / frames;
  }

  /**
   * Objects of a room that follow the session: task lamps, context cobwebs, cost emeralds.
   */
  updateRoom(player, time) {
    const room = this.rooms.get(player.id);
    if (!room) return;
    const cost = player.costUSD ?? 0;
    room.emeralds.set(Math.min(EMERALD_LEVELS, cost > 0 ? Math.floor(Math.log2(cost + 1)) + 1 : 0));
    const pct = player.context?.pct ?? 0;
    room.cobwebs.set(COBWEB_THRESHOLDS.filter((threshold) => pct >= threshold).length);
    const tasks = player.tasks;
    if (room.lamps && tasks?.total) {
      const lit = Math.round((tasks.done / tasks.total) * room.lamps.size);
      const blinkOn = Math.floor(time / LAMP_BLINK_MS) % 2 === 0;
      room.lamps.set(Math.min(room.lamps.size, lit + (tasks.current && blinkOn && lit < room.lamps.size ? 1 : 0)));
    }
  }

  /**
   * Quota portals of each account, and scrolling of their animated textures.
   */
  updatePortals(accounts, time) {
    for (const account of accounts) {
      const portal = this.portals.get(account.id);
      if (!portal) continue;
      const fiveHour = account.usage?.fiveHour?.usedPct ?? 0;
      portal.nether.set(Math.min(NETHER_FRAME.length, Math.floor(fiveHour / 10)));
      portal.netherPortal.visible = fiveHour >= 100;
      this.lightPortal(portal.netherLight, fiveHour >= 100);
      const sevenDay = account.usage?.sevenDay?.usedPct ?? 0;
      portal.eyes.set(Math.min(END_FRAME.length, Math.floor((sevenDay / 100) * END_FRAME.length)));
      portal.endPortal.visible = sevenDay >= 100;
      this.lightPortal(portal.endLight, sevenDay >= 100);
      const netherMap = portal.netherPortal.material.map;
      if (netherMap?.userData.frames) netherMap.offset.y = Math.floor(time / 50) % netherMap.userData.frames / netherMap.userData.frames;
      const endMap = portal.endPortal.material.map;
      if (endMap) endMap.offset.set((time / 40000) % 1, (time / 60000) % 1);
    }
  }

  /**
   * Night: room lamps (and the ambiance of Nether or End zones) shine brighter.
   */
  setGloom(gloom) {
    this.gloom = gloom;
    this.group.traverse((object) => {
      if (object.isPointLight && object.userData.baseIntensity) this.applyLight(object);
    });
  }

  /**
   * In full sun, lamps change almost nothing in the image, but every light costs on every pixel of
   * the screen: they only turn on with dimness. A portal only lights up if it is open.
   */
  lightPortal(light, open) {
    if (light.userData.active === open) return;
    light.userData.active = open;
    this.applyLight(light);
  }

  applyLight(light) {
    const gloom = this.gloom ?? 0;
    light.intensity = light.userData.baseIntensity * (LIGHT_GAIN.base + LIGHT_GAIN.gloom * gloom);
    light.visible = gloom >= LIGHTS_ON_GLOOM && light.userData.active !== false;
  }

  setFurnace(playerId, lit) {
    const room = this.rooms.get(playerId);
    if (room && room.lit !== lit) {
      room.furnace.material = blockShape(lit ? BLOCKS.furnaceOn : BLOCKS.furnace).materials;
      room.lit = lit;
    }
  }
}
