import * as THREE from 'three';
import { reducedMotion } from './motion.js';

// Right click on a villager: its player cracks a lead on it like a whip. Just for fun: the villager flinches and
// works faster on screen for a while, the sub-agent itself is left alone.

// Steps of a lash, in seconds: the arm goes up with the lead, strikes, then the rope falls slack and comes back.
const RAISE_S = 0.26;
const STRIKE_S = 0.12;
const RECOIL_S = 0.38;
const LASH_S = RAISE_S + STRIKE_S + RECOIL_S;
// Right arm angle (around x): raised above the head and a little behind, then thrown forward at the villager.
const ARM_RAISED = -3.3;
const ARM_STRUCK = -0.8;
// The rope lands on the villager's back.
const VILLAGER_BACK = 1.2;
// Drawn like the leash in the game: short segments alternating two browns.
const SEGMENTS = 22;
const THICKNESS = 0.1;
const ROPE_COLORS = ['#85461b', '#5e2f10'].map((color) => new THREE.Color(color));
// Ripple that runs along the rope from the hand to the tip, after the strike.
const RIPPLE = 0.22;
// A villager that was whipped sweats for as long as it rushes.
const SWEAT_PER_S = 5;

const UP = new THREE.Vector3(0, 1, 0);
const segmentGeometry = new THREE.BoxGeometry(1, 1, 1);
const ropeMaterial = new THREE.MeshLambertMaterial();
const matrix = new THREE.Matrix4();
const middle = new THREE.Vector3();
const direction = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();

const mix = (from, to, amount) => from + (to - from) * amount;
const easeOut = (amount) => 1 - (1 - amount) ** 2;
const smooth = (amount) => amount * amount * (3 - 2 * amount);

/**
 * Angle of the right arm of a player cracking the lead, `rest` being the one of its pose.
 */
export function lashArm({ time, from }, rest) {
  if (time < RAISE_S) return mix(from, ARM_RAISED, easeOut(time / RAISE_S));
  if (time < RAISE_S + STRIKE_S) return mix(ARM_RAISED, ARM_STRUCK, ((time - RAISE_S) / STRIKE_S) ** 2);
  return mix(ARM_STRUCK, rest, smooth(Math.min(1, (time - RAISE_S - STRIKE_S) / RECOIL_S)));
}

export class Whips {
  constructor(scene, particles, onCrack) {
    this.scene = scene;
    this.particles = particles;
    this.onCrack = onCrack;
    this.lashes = new Map();
    this.sweating = new Set();
    this.hand = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.start = new THREE.Vector3();
    this.control = new THREE.Vector3();
    this.points = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
  }

  /**
   * The player cracks its lead on one of its villagers. Asked again before the crack, it only changes target.
   */
  lash(player, villager) {
    if (reducedMotion()) return this.crack(villager);
    const current = this.lashes.get(player);
    if (current && !current.cracked) {
      current.villager = villager;
      return;
    }
    if (current) this.end(current);
    const rope = new THREE.InstancedMesh(segmentGeometry, ropeMaterial, SEGMENTS);
    ROPE_COLORS.forEach((color, parity) => {
      for (let index = parity; index < SEGMENTS; index += 2) rope.setColorAt(index, color);
    });
    rope.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rope.frustumCulled = false;
    this.scene.add(rope);
    const lash = { player, villager, rope, time: 0, from: player.rightArm?.rotation.x ?? 0, cracked: false };
    player.lash = lash;
    this.lashes.set(player, lash);
  }

  /**
   * The rope lands: sparks on the villager, an angry cloud above its head, the sound if it is on.
   */
  crack(villager) {
    const { x, y, z } = villager.root.position;
    const motion = !reducedMotion();
    this.particles.emit('crit', { x, y: y + VILLAGER_BACK, z }, { count: motion ? 8 : 3, spread: 0.4, velocity: [0, 1.2, 0], life: 0.5, size: 0.14, gravity: 3 });
    this.particles.emit('angry', { x, y: y + 2.2, z }, { count: motion ? 2 : 1, spread: 0.4, velocity: [0, 0.5, 0], life: 1.1, size: 0.4 });
    villager.whipped({ hop: motion });
    this.sweating.add(villager);
    this.onCrack?.();
  }

  end(lash) {
    lash.rope.removeFromParent();
    lash.rope.dispose();
    if (lash.player.lash === lash) lash.player.lash = null;
    this.lashes.delete(lash.player);
  }

  update(dt) {
    for (const lash of this.lashes.values()) {
      lash.time += dt;
      // The session went away in the meantime.
      if (lash.time >= LASH_S || !lash.player.root.parent) {
        this.end(lash);
        continue;
      }
      if (!lash.cracked && lash.time >= RAISE_S + STRIKE_S) {
        lash.cracked = true;
        if (lash.villager.root.parent) this.crack(lash.villager);
      }
      this.draw(lash);
    }
    for (const villager of this.sweating) {
      if (!villager.zeal || !villager.root.parent) {
        this.sweating.delete(villager);
      } else if (!reducedMotion() && Math.random() < SWEAT_PER_S * dt) {
        const { x, y, z } = villager.root.position;
        this.particles.emit('sweat', { x, y: y + 2, z }, { spread: 0.3, velocity: [0, 1.4, 0], life: 0.6, size: 0.12, gravity: 6 });
      }
    }
  }

  /**
   * The rope from the hand to its tip: a curve that rises (`bow` > 0) or sags, with a ripple after the strike.
   */
  draw(lash) {
    const { time } = lash;
    const hand = lash.player.handPosition(this.hand);
    const target = this.target.copy(lash.villager.root.position);
    target.y += VILLAGER_BACK;
    const forward = this.forward.subVectors(target, hand).setY(0);
    const reach = forward.length();
    if (reach > 0.001) forward.divideScalar(reach);
    else forward.set(0, 0, 1);
    const tip = this.tip;
    let bow;
    let ripple = 0;
    if (time < RAISE_S) {
      // Raised: the rope trails behind the hand.
      const amount = easeOut(time / RAISE_S);
      tip.copy(hand).addScaledVector(UP, 0.2 + amount).addScaledVector(forward, -0.2 - amount);
      bow = -0.3;
    } else if (time < RAISE_S + STRIKE_S) {
      // Strike: the tip goes over the head and comes down on the villager.
      const amount = ((time - RAISE_S) / STRIKE_S) ** 2;
      const from = this.start.copy(hand).addScaledVector(UP, 1.2).addScaledVector(forward, -1.2);
      const peak = hand.y + 2.2;
      tip.lerpVectors(from, target, amount);
      tip.y = mix(mix(from.y, peak, amount), mix(peak, target.y, amount), amount);
      bow = 0.5 * (1 - amount) + 0.08;
      ripple = amount;
    } else {
      // Recoil: the rope falls slack on the villager, then comes back to the hand.
      const amount = (time - RAISE_S - STRIKE_S) / RECOIL_S;
      tip.lerpVectors(target, hand, smooth(Math.max(0, (amount - 0.3) / 0.7)));
      tip.y -= 0.5 * Math.sin(Math.PI * amount);
      bow = -0.5 * Math.sin(Math.PI * Math.min(1, amount * 1.5));
      ripple = 1 - amount;
    }
    const length = hand.distanceTo(tip);
    const control = this.control.lerpVectors(hand, tip, 0.5).addScaledVector(UP, bow * length);
    const side = this.side.crossVectors(forward, UP);
    this.points.forEach((point, index) => {
      const s = index / SEGMENTS;
      const a = (1 - s) ** 2;
      const b = 2 * s * (1 - s);
      const c = s * s;
      point.set(
        a * hand.x + b * control.x + c * tip.x,
        a * hand.y + b * control.y + c * tip.y,
        a * hand.z + b * control.z + c * tip.z,
      );
      point.addScaledVector(side, RIPPLE * ripple * Math.sin(Math.PI * s) * Math.sin(3 * Math.PI * s - time * 40));
    });
    this.place(lash.rope);
  }

  place(rope) {
    for (let index = 0; index < SEGMENTS; index++) {
      const [from, to] = [this.points[index], this.points[index + 1]];
      direction.subVectors(to, from);
      const length = direction.length();
      middle.lerpVectors(from, to, 0.5);
      if (length > 0.0001) rotation.setFromUnitVectors(UP, direction.divideScalar(length));
      // A little longer than the gap, so the segments overlap at the bends.
      scale.set(THICKNESS, length + THICKNESS, THICKNESS);
      rope.setMatrixAt(index, matrix.compose(middle, rotation, scale));
    }
    rope.instanceMatrix.needsUpdate = true;
  }
}
