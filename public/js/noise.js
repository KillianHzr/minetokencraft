// Deterministic noise for the scenery: the same cell always gives the same roll, from one load to the next.

/**
 * Value between 0 and 1 specific to a cell and a salt. Integer hash with the MurmurHash3 final mix:
 * two nearby salts give independent rolls (without it, the flower type followed the "flower or not" roll).
 */
export function noise(x, z, salt = 0) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ease = (t) => t * t * (3 - 2 * t);

/**
 * Smooth noise: rolls at the nodes of a grid with step `scale`, interpolated between them.
 */
export function smoothNoise(x, z, scale, salt = 0) {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = ease(gx - x0);
  const tz = ease(gz - z0);
  const a = noise(x0, z0, salt);
  const b = noise(x0 + 1, z0, salt);
  const c = noise(x0, z0 + 1, salt);
  const d = noise(x0 + 1, z0 + 1, salt);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/**
 * Several layers of smooth noise, increasingly fine (reliefs, ridges), between 0 and 1.
 */
export function fbm(x, z, scale, salt = 0, octaves = 3) {
  let total = 0;
  let weight = 1;
  let sum = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += smoothNoise(x, z, scale / 2 ** octave, salt + octave * 31) * weight;
    sum += weight;
    weight /= 2;
  }
  return total / sum;
}

export function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
