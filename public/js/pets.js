import * as THREE from 'three';
import { limb, skinModel } from './mcbox.js';
import { loadTexture, TEXTURE_ROOT } from './textures.js';
import { castShadows, Entity, modelMaterials } from './entities.js';
import { hash } from './identity.js';

// Every player has a pet, the same one for the whole session: a wolf that follows it around and sits when it stops,
// wagging its tail as it works, or a cat that strolls around the room and curls up for a nap once the session is done.

const PX = 1 / 16;
const HALF_PI = Math.PI / 2;
// Minecraft model coordinates: y points down from 24 (the floor), front at -z. They are converted, as in mobs.js.
const pivot = (x, y, z) => [x, 24 - y, -z];
const box = (u, v, x, y, z, w, h, d) => ({ uv: [u, v], from: [x, -(y + h), -(z + d)], size: [w, h, d] });

const SPECIES = {
  wolf: {
    textures: ['entity/wolf/wolf_tame'],
    tex: [64, 32], speed: 3.4, scale: 1,
    parts: {
      head: [pivot(-1, 13.5, -7), [box(0, 0, -2, -3, -2, 6, 6, 4), box(16, 14, -2, -5, 0, 2, 2, 1), box(16, 14, 2, -5, 0, 2, 2, 1), box(0, 10, -0.5, 0, -5, 3, 3, 4)]],
      body: [pivot(0, 14, 2), [box(18, 14, -3, -2, -3, 6, 9, 6)], HALF_PI],
      mane: [pivot(-1, 14, -3), [box(21, 0, -3, -3, -3, 8, 6, 7)], HALF_PI],
      hindRight: [pivot(-2.5, 16, 7), [box(0, 18, 0, 0, -1, 2, 8, 2)]],
      hindLeft: [pivot(0.5, 16, 7), [box(0, 18, 0, 0, -1, 2, 8, 2)]],
      frontRight: [pivot(-2.5, 16, -4), [box(0, 18, 0, 0, -1, 2, 8, 2)]],
      frontLeft: [pivot(0.5, 16, -4), [box(0, 18, 0, 0, -1, 2, 8, 2)]],
      tail: [pivot(-1, 12, 8), [box(9, 18, 0, 0, -1, 2, 8, 2)], Math.PI / 5],
    },
  },
  cat: {
    textures: ['entity/cat/tabby', 'entity/cat/black', 'entity/cat/red', 'entity/cat/siamese', 'entity/cat/british_shorthair', 'entity/cat/calico',
      'entity/cat/ragdoll', 'entity/cat/jellie'],
    tex: [64, 32], speed: 2.2, scale: 0.8,
    parts: {
      head: [pivot(0, 15, -9), [box(0, 0, -2.5, -2, -3, 5, 4, 5), box(0, 24, -1.5, -0.02, -4, 3, 2, 2), box(0, 10, -2, -3, 0, 1, 1, 2), box(6, 10, 1, -3, 0, 1, 1, 2)]],
      body: [pivot(0, 12, -10), [box(20, 0, -2, 3, -8, 4, 16, 6)], HALF_PI],
      tail: [pivot(0, 15, 8), [box(0, 15, -0.5, 0, 0, 1, 8, 1)], 0.9],
      tailTip: [pivot(0, 20, 14), [box(4, 15, -0.5, 0, 0, 1, 8, 1)], 1.7],
      hindLeft: [pivot(1.1, 18, 5), [box(8, 13, -1, 0, 1, 2, 6, 2)]],
      hindRight: [pivot(-1.1, 18, 5), [box(8, 13, -1, 0, 1, 2, 6, 2)]],
      frontLeft: [pivot(1.2, 14.1, -5), [box(40, 0, -1, 0, 0, 2, 10, 2)]],
      frontRight: [pivot(-1.2, 14.1, -5), [box(40, 0, -1, 0, 0, 2, 10, 2)]],
    },
  },
};
const LEGS = ['hindRight', 'frontLeft', 'hindLeft', 'frontRight'];
// The wolf keeps this far from its player, behind it; closer, it sits down.
const HEEL_DISTANCE = 0.9;
const SIT_DISTANCE = 0.25;
// Same enlargement as the players, so they read from above; and never too close to the low front wall of the room,
// which would hide them.
const PET_SCALE = 1.2;
// The cat changes spot every few seconds, while its player works.
const STROLL_MIN_S = 4;
const STROLL_MAX_S = 10;

/**
 * Pet of a player, picked from its id: wolf or cat, and the cat's coat.
 */
export function petFor(playerId) {
  const kind = hash(`pet:${playerId}`) % 2 ? 'wolf' : 'cat';
  const textures = SPECIES[kind].textures;
  return { kind, texture: textures[hash(`coat:${playerId}`) % textures.length] };
}

export class Pet extends Entity {
  constructor({ kind, texture }) {
    super(1, PET_SCALE);
    this.kind = kind;
    this.species = SPECIES[kind];
    this.speed = this.species.speed;
    this.model.scale.setScalar(PX * this.species.scale);
    this.pose = 'stand';
    this.strollIn = 0;
    loadTexture(`${TEXTURE_ROOT}${texture}.png`).then((map) => this.build(map));
  }

  build(texture) {
    const materials = modelMaterials(texture);
    this.parts = {};
    for (const [name, [at, boxes, rotation = 0]] of Object.entries(this.species.parts)) {
      const part = limb(this.model, at, boxes, this.species.tex, materials);
      part.rotation.x = rotation;
      this.parts[name] = part;
    }
    // Rest angles, to come back to after a pose.
    this.rest = Object.fromEntries(Object.entries(this.parts).map(([name, part]) => [name, part.rotation.x]));
    const bones = skinModel(this.model);
    for (const name of Object.keys(this.parts)) this.parts[name] = bones.get(this.parts[name]);
    castShadows(this.model);
    this.built = true;
  }

  /**
   * Where the pet goes, given its player's position and status, and the room (null once the player leaves it).
   */
  follow(player, entity, room, spots, dt) {
    const position = entity.root.position;
    if (this.kind === 'wolf' || !room) {
      // Next to its player, on the camera side of the desks (behind them, it would be hidden), clear of the armchair
      // and of the emerald pile. Out of the room, it simply trots behind.
      let x = position.x + HEEL_DISTANCE * 0.8;
      let z = position.z + HEEL_DISTANCE;
      if (room) {
        x = THREE.MathUtils.clamp(x, room.x0 + spots.leftmost, room.x0 + spots.rightmost);
        z = THREE.MathUtils.clamp(z, room.z0 + spots.desks, room.z0 + spots.frontmost);
      }
      this.moveTo(x, 0, z);
      const close = Math.hypot(this.root.position.x - x, this.root.position.z - z) < SIT_DISTANCE;
      this.pose = close && !entity.moving ? 'sit' : 'stand';
      this.restYaw = Math.atan2(position.x - this.root.position.x, position.z - this.root.position.z);
      this.excited = player.status === 'waiting' ? 2 : player.status === 'working' ? 1 : 0;
      return;
    }
    // The cat naps by the armchair once the session is done; otherwise it strolls from spot to spot.
    if (player.status === 'done') {
      this.moveTo(room.x0 + spots.nap[0], 0, room.z0 + spots.nap[1]);
      this.pose = this.moving ? 'stand' : 'sleep';
      return;
    }
    this.strollIn -= dt;
    if (this.strollIn <= 0) {
      this.strollIn = STROLL_MIN_S + Math.random() * (STROLL_MAX_S - STROLL_MIN_S);
      const [dx, dz] = spots.stroll[Math.floor(Math.random() * spots.stroll.length)];
      this.moveTo(room.x0 + dx, 0, room.z0 + dz);
      this.restYaw = Math.random() * Math.PI * 2;
    }
    this.pose = this.moving ? 'stand' : 'sit';
  }

  update(dt) {
    this.clock += dt;
    this.updateMovement(dt);
    if (!this.built) return;
    const t = this.clock;
    const parts = this.parts;
    for (const [name, angle] of Object.entries(this.rest)) parts[name].rotation.set(angle, 0, 0);
    this.posture.rotation.set(0, 0, 0);
    this.posture.position.set(0, 0, 0);
    if (this.moving) {
      const swing = Math.sin(t * 10) * 0.7;
      LEGS.forEach((name, index) => (parts[name].rotation.x += index % 2 ? -swing : swing));
    } else if (this.pose === 'sit') {
      // Rear on the floor, hind legs folded forward, front legs straight.
      this.posture.rotation.x = -0.35;
      this.posture.position.y = -0.12;
      parts.hindLeft.rotation.x = -HALF_PI * 0.9;
      parts.hindRight.rotation.x = -HALF_PI * 0.9;
      parts.frontLeft.rotation.x = 0.35;
      parts.frontRight.rotation.x = 0.35;
    } else if (this.pose === 'sleep') {
      // Curled up on its side, breathing slowly.
      this.posture.rotation.z = HALF_PI * 0.92;
      this.posture.position.y = 0.12 + Math.sin(t * 1.5) * 0.01;
      parts.head.rotation.x = 0.3;
    }
    if (this.kind === 'wolf') {
      // The tail wags as the session works, faster when it waits for you.
      const wag = [0.1, 0.35, 0.6][this.excited ?? 0];
      parts.tail.rotation.y = Math.sin(t * (6 + 6 * (this.excited ?? 0))) * wag;
      if (this.pose === 'sit' && this.excited === 2) parts.head.rotation.x = -0.25;
    } else if (this.pose !== 'sleep') {
      parts.tail.rotation.z = Math.sin(t * 1.8) * 0.25;
    }
    if (!this.moving && this.pose !== 'sleep') parts.head.rotation.y = Math.sin(t * 0.5) * 0.35;
  }
}
