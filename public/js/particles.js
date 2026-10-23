import * as THREE from 'three';
import { pixelated } from './textures.js';

// Small hand-drawn pixelated particles (8 x 8).
const SHAPES = {
  poof: { color: '#e8e8e8', pixels: ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'] },
  sparkle: { color: '#7cc4ff', pixels: ['...#....', '...#....', '..###...', '#######.', '..###...', '...#....', '...#....', '........'] },
  chip: { color: '#9c7a4b', pixels: ['######..', '######..', '######..', '######..', '######..', '######..', '........', '........'] },
  zzz: { color: '#ffffff', pixels: ['########', '######..', '....##..', '...##...', '..##....', '.##.....', '########', '########'] },
  flame: { color: '#ffa53a', pixels: ['...#....', '..##....', '..###...', '.####...', '.#####..', '######..', '.####...', '..##....'] },
  // Black smoke above a session that may be stuck.
  soot: { color: '#2b2b2b', pixels: ['........', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..', '........'] },
  smoke: { color: '#8a8a8a', pixels: ['........', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..', '........'] },
  // Autumn dead leaves and spring petals.
  leafOrange: { color: '#d9761f', pixels: ['........', '...##...', '..####..', '.######.', '..####..', '...##...', '....#...', '........'] },
  leafRed: { color: '#b8361e', pixels: ['........', '...##...', '..####..', '.######.', '..####..', '...##...', '....#...', '........'] },
  leafYellow: { color: '#e0b02a', pixels: ['........', '...##...', '..####..', '.######.', '..####..', '...##...', '....#...', '........'] },
  petal: { color: '#f4a6c8', pixels: ['........', '........', '...##...', '..####..', '..####..', '...##...', '........', '........'] },
  // Nether embers and End portal particles.
  ember: { color: '#ff7a2a', pixels: ['........', '........', '...##...', '..####..', '..####..', '...##...', '........', '........'] },
  portal: { color: '#c27bff', pixels: ['........', '...#....', '..###...', '.#####..', '..###...', '...#....', '........', '........'] },
  // Hit on a mob: dark damage hearts, critical hit sparks, experience orbs.
  damage: { color: '#6b0a0a', pixels: ['........', '.##.##..', '#######.', '#######.', '.#####..', '..###...', '...#....', '........'] },
  crit: { color: '#e8e8e8', pixels: ['...#....', '...#....', '...#....', '###.###.', '...#....', '...#....', '...#....', '........'] },
  xp: { color: '#b6f23a', pixels: ['........', '..###...', '.#####..', '.#####..', '.#####..', '..###...', '........', '........'] },
  // Enchanting table runes, flying from the books to the reader.
  glyph: { color: '#d9c8ff', pixels: ['.#####..', '.#...#..', '.#.#.#..', '...#....', '.#.#.#..', '.#...#..', '.#####..', '........'] },
};

function shapeTexture({ color, pixels }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  pixels.forEach((row, y) => [...row].forEach((cell, x) => cell === '#' && context.fillRect(x, y, 1, 1)));
  return pixelated(new THREE.CanvasTexture(canvas));
}

// Maximum live particles per shape: beyond that, new ones are ignored.
const CAPACITY = 400;
const matrix = new THREE.Matrix4();
const scale = new THREE.Vector3();
const noRotation = new THREE.Quaternion();

/**
 * All the particles of a shape in a single instanced mesh (one draw call per shape). The camera never
 * rotates: the squares are oriented once and for all to face it (`facing`).
 */
export class Particles {
  constructor(scene, facing) {
    this.live = [];
    const quad = new THREE.PlaneGeometry(1, 1).applyQuaternion(facing);
    this.meshes = Object.fromEntries(Object.entries(SHAPES).map(([name, shape]) => {
      const mesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: shapeTexture(shape), alphaTest: 0.5 }), CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return [name, { mesh, live: 0 }];
    }));
  }

  emit(type, origin, { count = 1, spread = 0.25, velocity = [0, 1, 0], life = 1, size = 0.15, gravity = 0 } = {}) {
    const slot = this.meshes[type];
    for (let i = 0; i < count && slot.live < CAPACITY; i++) {
      slot.live += 1;
      const jitter = () => (Math.random() - 0.5) * spread * 2;
      this.live.push({
        type,
        position: new THREE.Vector3(
          origin.x + (Math.random() - 0.5) * spread,
          origin.y + (Math.random() - 0.5) * spread,
          origin.z + (Math.random() - 0.5) * spread,
        ),
        velocity: new THREE.Vector3(velocity[0] + jitter(), velocity[1] + jitter(), velocity[2] + jitter()),
        life,
        maxLife: life,
        size,
        gravity,
      });
    }
  }

  update(dt) {
    for (const slot of Object.values(this.meshes)) slot.live = 0;
    this.live = this.live.filter((particle) => {
      particle.life -= dt;
      if (particle.life <= 0) return false;
      particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      // Particles shrink at the end of their life rather than fade out.
      scale.setScalar(particle.size * Math.min(1, (particle.life / particle.maxLife) * 2));
      const slot = this.meshes[particle.type];
      slot.mesh.setMatrixAt(slot.live, matrix.compose(particle.position, noRotation, scale));
      slot.live += 1;
      return true;
    });
    for (const { mesh, live } of Object.values(this.meshes)) {
      if (mesh.count === 0 && live === 0) continue;
      mesh.count = live;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
