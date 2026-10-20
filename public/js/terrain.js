import { fbm, noise, smoothNoise, smoothstep } from './noise.js';

// The landscape around the house, instead of an island floating in the void: rocky mountains behind, rising
// beyond the top of the screen; wooded hills on the left; a river running in front; a low meadow
// beyond. A dirt path goes around the property. The flat area in the center follows the house plan, the
// terrain is shaped around it, and the whole covers everything the camera sees, corners included: never any void.
//
// On the camera side (front, right), the terrain stays low: it must never hide a room.

// Strip of flat terrain around the house before the relief starts.
const FLAT_MARGIN = 2;
// Rise per block behind the house, and to the left, then bumps and peaks on top.
const MOUNTAIN_SLOPE = 1.6;
const HILL_SLOPE = 0.6;
const HILLS = 3;
const PEAKS = 8;
const CRAGS = 10;
// In front and to the right: at most one block above the house's floor.
const LOW_CAP = 1;
const ROCK_LINE = 8;
const SNOW_LINE = 14;
const RIVER = {
  // Distance between the front of the house and the river's axis.
  offset: 8,
  halfWidth: 2.3,
  // Meanders: random offset of the axis, in blocks.
  meander: 2,
  // Gentle slope of the banks toward the water.
  valley: 5,
  // Top of the bed: shallower at the edges.
  deep: -2,
  shallow: -1,
};
// The path going around the property, just outside the garden, lined with a torch every few blocks.
const PATH_WIDTH = 1;
const TORCH_EVERY = 6;
// Trees on a 5-block grid, at most one per cell, randomly offset within its cell.
const TREE_GRID = 5;
// In front and to the right, trees stay far away: closer, they would overlap the house on screen.
const OPEN_GROUND = 14;

const NONE = -32768;

// Foliage by season; in winter, a layer of snow on top of the trees.
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
 * Oak: trunk, two-tier foliage; in spring azalea flowers mix in, in autumn each tree
 * has its own color.
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
 * Birch: taller white trunk, narrower foliage, yellow in autumn.
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
 * Spruce: a cone of alternating tiers, wide then narrow, up to a tip; always green.
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
 * Rock of a mountainside: mostly stone, with veins of andesite, stone bricks and gravel.
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
 * Builds the landscape. `flat`: the house's flat area (garden included), which the garden fills itself;
 * `cover`: the rectangle of cells to cover to fill the view; `ceiling(x, z)`: height beyond which a
 * column leaves through the top of the screen (no need to raise it higher; negative, the cell is out of view).
 * `flora`: the season's flowers and grasses.
 */
export function buildTerrain(blocks, { flat, cover, ceiling }, season, flora) {
  const width = cover.x1 - cover.x0 + 1;
  const depth = cover.z1 - cover.z0 + 1;
  const at = (x, z) => (x < cover.x0 || x > cover.x1 || z < cover.z0 || z > cover.z1 ? -1 : (z - cover.z0) * width + (x - cover.x0));
  const isFlat = (x, z) => x >= flat.x0 && x <= flat.x1 && z >= flat.z0 && z <= flat.z1;
  const tops = new Int16Array(width * depth).fill(NONE);
  const water = new Uint8Array(width * depth);
  const river = new Float32Array(width * depth);

  // The river crosses the whole front, from one edge of the view to the other.
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
      // In front and to the right (camera side), the terrain flattens out.
      const low = Math.max(smoothstep(flat.z1 - 2, flat.z1 + 6, z), smoothstep(flat.x1 - 2, flat.x1 + 6, x) * smoothstep(flat.z0 - 6, flat.z0 + 2, z));
      // Massifs: the slope rises behind and to the left, at varying speed depending on the place (cols and summits).
      const slope = Math.max(0, behind - FLAT_MARGIN) * MOUNTAIN_SLOPE + Math.max(0, left - FLAT_MARGIN) * HILL_SLOPE;
      const massif = slope * (0.6 + 0.8 * smoothNoise(x, z, 16, 5));
      // Sharp ridges on top, where the relief is already high.
      const ridge = (1 - Math.abs(smoothNoise(x, z, 11, 6) * 2 - 1)) * PEAKS * smoothstep(3, 12, slope);
      // Outcrops and gullies that break up the regularity of the steps.
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
        // Stone flanks; the gentle ledges keep their grass, like in the game.
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
      // Torches along the outer edge of the path, on its straight sides.
      if (top === 0 && !bank && Math.abs(awayFromFlat(x, z) - PATH_WIDTH - 1) < 0.01 && (((x + z) % TORCH_EVERY) + TORCH_EVERY) % TORCH_EVERY === 0) {
        blocks.plants.push({ type: 'torch', x, y: top, z });
        blocks.torches.push({ x: x + 0.5, y: top, z: z + 0.5 });
        continue;
      }
      // Sugar cane at the water's edge.
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

  // Trees: dense forest of oaks and birches on the left, spruces at the foot of the mountains, a few trees far away
  // in the meadow.
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
