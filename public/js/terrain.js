import { fbm, noise, smoothNoise, smoothstep } from './noise.js';

// Le paysage autour de la maison, à la place d'une île qui flotte dans le vide : des montagnes rocheuses derrière, qui
// montent au-delà du haut de l'écran ; des collines boisées à gauche ; une rivière qui passe devant ; une prairie basse
// au-delà. Un chemin de terre fait le tour de la propriété. La zone plate du centre suit le plan de la maison, le
// relief se cale autour, et le tout couvre tout ce que voit la caméra, coins compris : on ne voit jamais le vide.
//
// Côté caméra (devant, à droite), le terrain reste bas : il ne doit jamais cacher une pièce.

// Bande de terrain plat autour de la maison avant que le relief commence.
const FLAT_MARGIN = 2;
// Montée par bloc derrière la maison, et à gauche, puis bosses et pics par-dessus.
const MOUNTAIN_SLOPE = 1.6;
const HILL_SLOPE = 0.6;
const HILLS = 3;
const PEAKS = 8;
const CRAGS = 10;
// Devant et à droite : au plus un bloc au-dessus du sol de la maison.
const LOW_CAP = 1;
const ROCK_LINE = 8;
const SNOW_LINE = 14;
const RIVER = {
  // Écart entre le devant de la maison et l'axe de la rivière.
  offset: 8,
  halfWidth: 2.3,
  // Méandres : décalage aléatoire de l'axe, en blocs.
  meander: 2,
  // Pente douce des berges vers l'eau.
  valley: 5,
  // Haut du lit : moins profond sur les bords.
  deep: -2,
  shallow: -1,
};
// Le chemin qui fait le tour de la propriété, juste à l'extérieur du jardin.
const PATH_WIDTH = 1;
// Arbres sur une grille de 5 blocs, un par case au plus, décalé au hasard dans sa case.
const TREE_GRID = 5;
// Devant et à droite, les arbres restent loin : plus près, ils mordraient sur la maison à l'écran.
const OPEN_GROUND = 14;

const NONE = -32768;

// Feuillages selon la saison ; l'hiver, une couche de neige sur le dessus des arbres.
const FOLIAGE = {
  spring: { oak: ['leaves', 'floweringAzalea'], birch: 'birchLeaves' },
  summer: { oak: ['leaves'], birch: 'birchLeaves' },
  autumn: { oak: ['leavesOrange', 'leavesRed', 'leavesYellow'], birch: 'birchLeavesAutumn' },
  winter: { oak: ['leaves'], birch: 'birchLeaves', snow: true },
};

function snowCap(blocks, season, x, y, z) {
  if (FOLIAGE[season].snow) blocks.carpets.push({ type: 'snow', x, y, z });
}

/**
 * Chêne : tronc, feuillage en deux étages ; au printemps des fleurs d'azalée s'y mêlent, à l'automne chaque arbre
 * a sa couleur.
 */
export function oakTree(blocks, x, z, trunk, season = 'summer', base = 0) {
  const leaves = FOLIAGE[season].oak;
  const treeLeaves = leaves[Math.floor(noise(x, z, 12) * leaves.length)];
  blocks.box('oakLog', x, x, base, base + trunk - 1, z, z);
  for (let y = trunk - 2; y <= trunk + 1; y++) {
    const radius = y >= trunk ? 1 : 2;
    for (let i = -radius; i <= radius; i++) {
      for (let k = -radius; k <= radius; k++) {
        if (i === 0 && k === 0 && y < trunk) continue;
        if (Math.abs(i) === radius && Math.abs(k) === radius && noise(x + i, z + k, y) < 0.6) continue;
        const type = season === 'spring' ? leaves[noise(x + i, z + k, y + 20) < 0.35 ? 1 : 0] : treeLeaves;
        blocks.set(type, x + i, base + y, z + k);
        if (y === trunk + 1 || Math.abs(i) === radius || Math.abs(k) === radius) snowCap(blocks, season, x + i, base + y + 1, z + k);
      }
    }
  }
}

/**
 * Bouleau : tronc blanc plus haut, feuillage plus étroit, jaune à l'automne.
 */
function birchTree(blocks, x, z, trunk, season, base) {
  const type = FOLIAGE[season].birch;
  blocks.box('birchLog', x, x, base, base + trunk - 1, z, z);
  for (let y = trunk - 2; y <= trunk + 1; y++) {
    const radius = y >= trunk ? 1 : 2;
    for (let i = -radius; i <= radius; i++) {
      for (let k = -radius; k <= radius; k++) {
        if (i === 0 && k === 0 && y < trunk) continue;
        if (Math.abs(i) === radius && Math.abs(k) === radius) continue;
        if (radius === 2 && (Math.abs(i) === 2 || Math.abs(k) === 2) && noise(x + i, z + k, y + 5) < 0.3) continue;
        blocks.set(type, x + i, base + y, z + k);
        if (y === trunk + 1 || radius === 2) snowCap(blocks, season, x + i, base + y + 1, z + k);
      }
    }
  }
}

/**
 * Sapin : un cône d'étages alternés, larges puis étroits, jusqu'à une pointe ; toujours vert.
 */
function spruceTree(blocks, x, z, trunk, season, base) {
  blocks.box('spruceLog', x, x, base, base + trunk - 1, z, z);
  const top = base + trunk + 1;
  for (let y = base + 2; y <= top; y++) {
    const fromTop = top - y;
    const radius = fromTop === 0 ? 0 : fromTop % 2 === 1 ? 1 : Math.min(2, 1 + Math.floor(fromTop / 3));
    for (let i = -radius; i <= radius; i++) {
      for (let k = -radius; k <= radius; k++) {
        if (i === 0 && k === 0 && y < base + trunk) continue;
        if (radius > 0 && Math.abs(i) + Math.abs(k) > radius + (radius === 2 ? 1 : 0)) continue;
        blocks.set('spruceLeaves', x + i, y, z + k);
        snowCap(blocks, season, x + i, y + 1, z + k);
      }
    }
  }
}

/**
 * Roche d'un flanc de montagne : surtout de la pierre, avec des veines d'andésite, de pierre taillée et de gravier.
 */
function rockAt(x, y, z) {
  const vein = smoothNoise(x + y * 3, z - y * 2, 4, 90);
  if (vein < 0.16) return 'rawAndesite';
  if (vein > 0.86) return 'cobblestone';
  return noise(x, y * 31 + z, 91) < 0.04 ? 'gravel' : 'stone';
}

function segmentDistance(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/**
 * Construit le paysage. `flat` : la zone plate de la maison (jardin compris), que le jardin remplit lui-même ;
 * `cover` : le rectangle de cases à couvrir pour remplir la vue ; `ceiling(x, z)` : hauteur au-delà de laquelle une
 * colonne sort par le haut de l'écran (inutile de la monter plus haut ; négative, la case est hors champ).
 * `flora` : fleurs et herbes de la saison.
 */
export function buildTerrain(blocks, { flat, cover, ceiling }, season, flora) {
  const width = cover.x1 - cover.x0 + 1;
  const depth = cover.z1 - cover.z0 + 1;
  const at = (x, z) => (x < cover.x0 || x > cover.x1 || z < cover.z0 || z > cover.z1 ? -1 : (z - cover.z0) * width + (x - cover.x0));
  const isFlat = (x, z) => x >= flat.x0 && x <= flat.x1 && z >= flat.z0 && z <= flat.z1;
  const tops = new Int16Array(width * depth).fill(NONE);
  const water = new Uint8Array(width * depth);
  const river = new Float32Array(width * depth);

  // La rivière traverse tout le devant, d'un bord à l'autre de la vue.
  const riverPath = [[cover.x1 + 10, flat.z1 + RIVER.offset], [cover.x0 - 10, flat.z1 + RIVER.offset]];
  const riverDistance = (x, z) => {
    const wx = x + (smoothNoise(x, z, 9, 40) - 0.5) * 2 * RIVER.meander;
    const wz = z + (smoothNoise(x, z, 9, 41) - 0.5) * 2 * RIVER.meander;
    return segmentDistance(wx, wz, riverPath[0], riverPath[1]);
  };
  const awayFromFlat = (x, z) => Math.hypot(Math.max(flat.x0 - x, 0, x - flat.x1), Math.max(flat.z0 - z, 0, z - flat.z1));

  for (let z = cover.z0; z <= cover.z1; z++) {
    for (let x = cover.x0; x <= cover.x1; x++) {
      const index = at(x, z);
      if (isFlat(x, z)) {
        tops[index] = 0;
        continue;
      }
      const highest = ceiling(x, z);
      if (highest < 0) continue;
      const distance = riverDistance(x, z);
      river[index] = distance;
      if (distance < RIVER.halfWidth) {
        tops[index] = distance < RIVER.halfWidth - 1.2 ? RIVER.deep : RIVER.shallow;
        water[index] = 1;
        continue;
      }
      const behind = flat.z0 - z;
      const left = flat.x0 - x;
      const away = awayFromFlat(x, z);
      // Devant et à droite (côté caméra), le terrain s'aplatit.
      const low = Math.max(smoothstep(flat.z1 - 2, flat.z1 + 6, z), smoothstep(flat.x1 - 2, flat.x1 + 6, x) * smoothstep(flat.z0 - 6, flat.z0 + 2, z));
      // Massifs : la pente monte derrière et à gauche, plus ou moins vite selon l'endroit (cols et sommets).
      const slope = Math.max(0, behind - FLAT_MARGIN) * MOUNTAIN_SLOPE + Math.max(0, left - FLAT_MARGIN) * HILL_SLOPE;
      const massif = slope * (0.6 + 0.8 * smoothNoise(x, z, 16, 5));
      // Arêtes pointues par-dessus, là où le relief est déjà haut.
      const ridge = (1 - Math.abs(smoothNoise(x, z, 11, 6) * 2 - 1)) * PEAKS * smoothstep(3, 12, slope);
      // Affleurements et ravines qui cassent la régularité des gradins.
      const crags = (fbm(x, z, 5, 7, 2) - 0.5) * CRAGS * smoothstep(3, 10, slope);
      const shape = (value) => {
        let height = value * smoothstep(RIVER.halfWidth + 1, RIVER.halfWidth + RIVER.valley, distance);
        height = Math.max(0, height + (Math.min(height, LOW_CAP) - height) * low);
        return Math.round(height);
      };
      const rolling = (fbm(x, z, 14, 1) - 0.35) * HILLS * smoothstep(FLAT_MARGIN, FLAT_MARGIN + 8, away);
      tops[index] = Math.min(shape(rolling + massif + ridge + crags), highest);
    }
  }

  const topAt = (x, z) => {
    const index = at(x, z);
    return index < 0 ? NONE : tops[index];
  };
  const lowestNeighbour = (x, z, top) => {
    let lowest = top;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbour = topAt(x + dx, z + dz);
      if (neighbour !== NONE) lowest = Math.min(lowest, neighbour);
    }
    return lowest;
  };
  const nextToWater = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => water[at(x + dx, z + dz)] === 1);
  const groundTop = { spring: 'grass', summer: 'grass', autumn: 'grassAutumn', winter: 'snowyGrass' }[season];
  const frozen = season === 'winter';

  for (let z = cover.z0; z <= cover.z1; z++) {
    for (let x = cover.x0; x <= cover.x1; x++) {
      const index = at(x, z);
      const top = tops[index];
      if (top === NONE || isFlat(x, z)) continue;
      const lowest = lowestNeighbour(x, z, top);
      const steep = top - lowest >= 2;
      const bank = !water[index] && river[index] < RIVER.halfWidth + 1.4 && top <= 1;
      let surface;
      let filler = 'dirt';
      if (water[index]) {
        surface = noise(x, z, 61) < 0.25 ? 'gravel' : noise(x, z, 62) < 0.12 ? 'clay' : 'sand';
        filler = surface;
        blocks.water.push({ x, z });
      } else if (bank) {
        surface = 'sand';
        filler = 'sand';
      } else if (top === 0 && awayFromFlat(x, z) <= PATH_WIDTH) {
        surface = 'path';
      } else if (frozen || top >= SNOW_LINE + Math.round(noise(x, z, 60) * 3)) {
        surface = steep && top >= ROCK_LINE ? 'snow' : 'snowyGrass';
        if (top >= ROCK_LINE) filler = 'rock';
      } else if (steep || (top >= ROCK_LINE && smoothNoise(x, z, 5, 63) < 0.45)) {
        // Flancs de pierre ; les corniches douces gardent leur herbe, comme dans le jeu.
        surface = rockAt(x, top - 1, z);
        filler = 'rock';
      } else {
        const patch = smoothNoise(x, z, 5, 65);
        surface = patch < 0.12 ? 'coarseDirt' : z < flat.z0 - 2 && top >= 4 && patch > 0.7 ? 'podzol' : groundTop;
      }
      blocks.set(surface, x, top - 1, z);
      for (let y = top - 2; y >= Math.min(top - 1, lowest); y--) {
        const rocky = filler === 'rock' || (filler === 'dirt' && top - y > 3);
        blocks.set(rocky ? rockAt(x, y, z) : filler, x, y, z);
      }

      if (water[index]) {
        if (!frozen && noise(x, z, 66) < 0.04) blocks.carpets.push({ type: 'lilyPad', x, y: -0.16, z });
        continue;
      }
      if (steep || surface === 'path') continue;
      // Cannes à sucre au bord de l'eau.
      if (bank && !frozen && nextToWater(x, z) && noise(x, z, 67) < 0.3) {
        const height = 1 + Math.floor(noise(x, z, 68) * 3);
        for (let k = 0; k < height; k++) blocks.plants.push({ type: 'sugarCane', x, y: top + k, z });
        continue;
      }
      if (bank) continue;
      const roll = noise(x, z, 69);
      const meadow = z > flat.z1 || x > flat.x1;
      if (!frozen && roll < (meadow ? flora.flowerRate * 1.5 : flora.flowerRate * 0.5) && flora.flowers.length) {
        blocks.plants.push({ type: flora.flowers[Math.floor(noise(x, z, 70) * flora.flowers.length)], x, y: top, z });
      } else if (season === 'autumn' && meadow && roll > 0.988) {
        blocks.set('pumpkin', x, top, z);
      } else if (!frozen && x < flat.x0 && roll > 0.985 && top < ROCK_LINE) {
        blocks.plants.push({ type: 'berryBush', x, y: top, z });
      } else if (flora.grass && top < ROCK_LINE && roll > 0.7) {
        blocks.plants.push({ type: roll > 0.93 && season !== 'autumn' && !meadow ? 'fern' : flora.grass, x, y: top, z });
      }
    }
  }

  // Arbres : forêt dense de chênes et de bouleaux à gauche, sapins au pied des montagnes, quelques arbres au loin
  // dans la prairie.
  for (let gz = Math.floor(cover.z0 / TREE_GRID); gz <= Math.floor(cover.z1 / TREE_GRID); gz++) {
    for (let gx = Math.floor(cover.x0 / TREE_GRID); gx <= Math.floor(cover.x1 / TREE_GRID); gx++) {
      const x = gx * TREE_GRID + 1 + Math.floor(noise(gx, gz, 80) * (TREE_GRID - 2));
      const z = gz * TREE_GRID + 1 + Math.floor(noise(gx, gz, 81) * (TREE_GRID - 2));
      const index = at(x, z);
      if (index < 0 || water[index] || tops[index] === NONE || isFlat(x, z)) continue;
      const top = tops[index];
      const away = awayFromFlat(x, z);
      if (away < 4 || top >= ROCK_LINE || river[index] < RIVER.halfWidth + 2 || top - lowestNeighbour(x, z, top) >= 2) continue;
      const open = z > flat.z1 || x > flat.x1;
      if (open && z < flat.z1 + OPEN_GROUND && x < flat.x1 + OPEN_GROUND) continue;
      const density = open ? 0.12 : x < flat.x0 ? 0.9 : 0.6;
      if (noise(gx, gz, 82) > density) continue;
      const trunk = 4 + Math.floor(noise(gx, gz, 83) * 3);
      const species = noise(gx, gz, 84);
      if (z < flat.z0 && (top >= 4 || species < 0.6)) spruceTree(blocks, x, z, trunk + 2, season, top);
      else if (species < 0.4 && !open) birchTree(blocks, x, z, trunk + 1, season, top);
      else oakTree(blocks, x, z, trunk, season, top);
    }
  }
}
