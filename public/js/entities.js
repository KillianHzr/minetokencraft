import * as THREE from 'three';
import { limb, skinModel } from './mcbox.js';
import { layeredTexture, loadTexture, pixelated, TEXTURE_ROOT } from './textures.js';
import { createItemMesh, createItemSprite, setItem, setSpriteItem } from './items.js';

const PX = 1 / 16;
// Échelle de rendu que Minecraft applique aux joueurs et aux villageois.
const MODEL_SCALE = 0.9375;
// Joueurs un peu agrandis (proportions intactes) pour rester lisibles vus du dessus ; les villageois gardent
// leur taille, ce qui les distingue aussi de leur joueur.
const CHARACTER_SCALE = 1.2;
const WALK_SPEED = 3.2;
export { castShadows };
// Assis sur le fauteuil : les hanches (à 12 pixels du sol) descendent jusqu'à l'assise, à un demi-bloc.
const HIP_HEIGHT = 12 * PX * MODEL_SCALE;
const SEAT_HEIGHT = 0.56;
const SEATED_DROP = SEAT_HEIGHT / CHARACTER_SCALE - HIP_HEIGHT;

// Bleu / jaune / orange plutôt que vert / rouge : lisible en daltonisme, comme la status line.
export const STATUS_COLORS = {
  waiting: '#ff8a1f',
  working: '#ffd23f',
  done: '#4da6ff',
  sleeping: '#9a9a9a',
};

function lerpAngle(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

function castShadows(model) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

let alertMaterial;
// « ! » orange en pixel art au-dessus d'un joueur qui t'attend.
function alertSprite() {
  if (!alertMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 12;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, 12, 12);
    context.fillStyle = STATUS_COLORS.waiting;
    context.fillRect(1, 1, 10, 10);
    context.fillStyle = '#000';
    context.fillRect(5, 2, 2, 5);
    context.fillRect(5, 8, 2, 2);
    alertMaterial = new THREE.SpriteMaterial({ map: pixelated(new THREE.CanvasTexture(canvas)), depthTest: false });
  }
  const sprite = new THREE.Sprite(alertMaterial);
  sprite.scale.setScalar(0.55);
  sprite.renderOrder = 20;
  sprite.visible = false;
  return sprite;
}

export function modelMaterials(texture) {
  return {
    base: new THREE.MeshLambertMaterial({ map: texture }),
    overlay: new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }),
  };
}

/**
 * Base commune : déplacement à pied vers une cible, orientation au repos, ancre de l'étiquette.
 */
export class Entity {
  constructor(height, scale = 1) {
    this.root = new THREE.Group();
    this.posture = new THREE.Group();
    this.model = new THREE.Group();
    this.model.scale.setScalar(PX * MODEL_SCALE);
    this.posture.add(this.model);
    this.root.add(this.posture);
    this.root.scale.setScalar(scale);
    this.labelAnchor = new THREE.Object3D();
    this.labelAnchor.position.y = height;
    this.root.add(this.labelAnchor);
    this.target = new THREE.Vector3();
    this.restYaw = 0;
    this.moving = false;
    this.clock = Math.random() * 10;
  }

  placeAt(x, y, z) {
    this.target.set(x, y, z);
    this.root.position.copy(this.target);
  }

  moveTo(x, y, z) {
    // Changer d'étage ne se fait pas à pied : on réapparaît directement dans la nouvelle pièce.
    if (Math.abs(y - this.target.y) > 0.5) this.root.position.set(x, y, z);
    this.target.set(x, y, z);
  }

  updateMovement(dt) {
    const dx = this.target.x - this.root.position.x;
    const dz = this.target.z - this.root.position.z;
    const distance = Math.hypot(dx, dz);
    this.moving = distance > 0.04;
    let yaw = this.restYaw;
    if (this.moving) {
      const step = Math.min(distance, (this.speed ?? WALK_SPEED) * dt);
      this.root.position.x += (dx / distance) * step;
      this.root.position.z += (dz / distance) * step;
      yaw = Math.atan2(dx, dz);
    }
    this.root.rotation.y = lerpAngle(this.root.rotation.y, yaw, 1 - Math.exp(-10 * dt));
  }

  walkCycle(legs, arms, amount) {
    const swing = Math.sin(this.clock * 9) * 0.7 * amount;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    if (arms) {
      arms[0].rotation.x = -swing;
      arms[1].rotation.x = swing;
    }
  }
}

export class Player extends Entity {
  constructor(skin) {
    // Le nametag flotte au-dessus du « ! » des joueurs qui t'attendent.
    super(2.75, CHARACTER_SCALE);
    this.pose = 'idle';
    this.item = createItemMesh(10);
    this.seated = 0;
    this.alert = alertSprite();
    this.alert.position.y = 2.45;
    this.root.add(this.alert);
    this.ready = loadTexture(skin.url).then((texture) => this.build(texture, skin.slim));
  }

  build(texture, slim) {
    const legacy = texture.image.height === 32;
    const tex = [64, legacy ? 32 : 64];
    const materials = modelMaterials(texture);
    const arm = slim ? 3 : 4;
    this.head = limb(this.model, [0, 24, 0], [
      { from: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] },
      { from: [-4, 0, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5, overlay: true },
    ], tex, materials);
    this.body = limb(this.model, [0, 12, 0], [
      { from: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16] },
      !legacy && { from: [-4, 0, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25, overlay: true },
    ], tex, materials);
    this.rightArm = limb(this.model, [-5, 22, 0], [
      { from: [1 - arm, -10, -2], size: [arm, 12, 4], uv: [40, 16] },
      !legacy && { from: [1 - arm, -10, -2], size: [arm, 12, 4], uv: [40, 32], inflate: 0.25, overlay: true },
    ], tex, materials);
    this.leftArm = limb(this.model, [5, 22, 0], [
      legacy
        ? { from: [-1, -10, -2], size: [arm, 12, 4], uv: [40, 16], mirror: true }
        : { from: [-1, -10, -2], size: [arm, 12, 4], uv: [32, 48] },
      !legacy && { from: [-1, -10, -2], size: [arm, 12, 4], uv: [48, 48], inflate: 0.25, overlay: true },
    ], tex, materials);
    this.rightLeg = limb(this.model, [-2, 12, 0], [
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 16] },
      !legacy && { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25, overlay: true },
    ], tex, materials);
    this.leftLeg = limb(this.model, [2, 12, 0], [
      legacy
        ? { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 16], mirror: true }
        : { from: [-2, -12, -2], size: [4, 12, 4], uv: [16, 48] },
      !legacy && { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25, overlay: true },
    ], tex, materials);
    // Objet tenu en main : manche dans la main, tête vers l'avant.
    this.item.position.set(1.5 - arm / 2 - 0.5, -9, 3.5);
    this.item.rotation.set(0, -Math.PI / 2, 0);
    this.rightArm.add(this.item);
    const bones = skinModel(this.model, [this.item]);
    for (const part of ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) this[part] = bones.get(this[part]);
    castShadows(this.model);
    this.built = true;
  }

  /**
   * work : tape sur un meuble ; read : lit un livre ; sit : se repose dans le fauteuil ; wave : t'appelle.
   */
  setPose(pose, itemName) {
    this.pose = pose;
    this.alert.visible = pose === 'wave';
    setItem(this.item, itemName);
  }

  update(dt) {
    this.clock += dt;
    this.updateMovement(dt);
    const t = this.clock;
    // Plus il t'attend longtemps, plus le « ! » grossit et s'agite.
    const pace = this.urgent ? 9 : 4;
    this.alert.position.y = 2.45 + Math.abs(Math.sin(t * pace)) * (this.urgent ? 0.3 : 0.15);
    this.alert.scale.setScalar(this.urgent ? 0.8 : 0.55);
    if (!this.built) return;

    const sit = this.pose === 'sit' && !this.moving;
    this.seated += ((sit ? 1 : 0) - this.seated) * (1 - Math.exp(-8 * dt));
    this.posture.position.y = SEATED_DROP * this.seated;

    for (const part of [this.head, this.rightArm, this.leftArm, this.rightLeg, this.leftLeg]) part.rotation.set(0, 0, 0);
    this.leftArm.rotation.z = 0.06;
    this.rightArm.rotation.z = -0.06;
    // Jambes repliées vers l'avant quand il est assis.
    this.rightLeg.rotation.x = -Math.PI / 2 * this.seated;
    this.leftLeg.rotation.x = -Math.PI / 2 * this.seated;

    if (this.moving) {
      this.walkCycle([this.rightLeg, this.leftLeg], [this.rightArm, this.leftArm], 1);
      return;
    }
    switch (this.pose) {
      case 'work': {
        // Coup de pioche à la Minecraft : un arc rapide vers l'avant.
        const phase = (t * 2.4) % 1;
        this.rightArm.rotation.x = -0.5 - 1.1 * Math.sin(phase * Math.PI);
        this.rightArm.rotation.y = -0.2;
        this.head.rotation.x = 0.35;
        break;
      }
      case 'read':
        this.rightArm.rotation.set(-1.0, 0, 0.35);
        this.leftArm.rotation.set(-1.0, 0, -0.35);
        this.head.rotation.x = 0.45 + Math.sin(t * 0.7) * 0.05;
        this.head.rotation.y = Math.sin(t * 1.3) * 0.12;
        break;
      case 'sit':
        this.rightArm.rotation.x = -0.45;
        this.leftArm.rotation.x = -0.45;
        this.head.rotation.y = Math.sin(t * 0.4) * 0.4;
        break;
      case 'wave':
        this.rightArm.rotation.z = -2.7 + Math.sin(t * 9) * 0.35;
        this.head.rotation.x = -0.1;
        break;
      default:
        this.head.rotation.y = Math.sin(t * 0.5) * 0.35;
        this.rightArm.rotation.z = -0.06 - Math.sin(t * 1.4) * 0.04;
        this.leftArm.rotation.z = 0.06 + Math.sin(t * 1.4) * 0.04;
    }
  }
}

export class Villager extends Entity {
  constructor(biome, profession) {
    super(2.35);
    this.status = 'working';
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: STATUS_COLORS.working, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.root.add(this.ring);
    this.icon = createItemSprite(0.5);
    this.icon.position.y = 2.5;
    this.root.add(this.icon);
    const layers = [
      'entity/villager/villager',
      `entity/villager/type/${biome}`,
      `entity/villager/profession/${profession}`,
    ].map((name) => `${TEXTURE_ROOT}${name}.png`);
    this.ready = layeredTexture(layers).then((texture) => this.build(texture));
  }

  build(texture) {
    const tex = [64, 64];
    const materials = modelMaterials(texture);
    this.head = limb(this.model, [0, 24, 0], [
      { from: [-4, 0, -4], size: [8, 10, 8], uv: [0, 0] },
      { from: [-4, 0, -4], size: [8, 10, 8], uv: [32, 0], inflate: 0.51, overlay: true },
      { from: [-1, -1, 4], size: [2, 4, 2], uv: [24, 0] },
    ], tex, materials);
    this.head.add(hatRim(texture));
    limb(this.model, [0, 12, 0], [
      { from: [-4, 0, -3], size: [8, 12, 6], uv: [16, 20] },
      { from: [-4, -8, -3], size: [8, 20, 6], uv: [0, 38], inflate: 0.05, overlay: true },
    ], tex, materials);
    this.arms = limb(this.model, [0, 21, 1], [
      { from: [-8, -6, -2], size: [4, 8, 4], uv: [44, 22] },
      { from: [4, -6, -2], size: [4, 8, 4], uv: [44, 22], mirror: true },
      { from: [-4, -6, -2], size: [8, 4, 4], uv: [40, 38] },
    ], tex, materials);
    this.arms.rotation.x = -0.75;
    this.rightLeg = limb(this.model, [-2, 12, 0], [
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 22] },
    ], tex, materials);
    this.leftLeg = limb(this.model, [2, 12, 0], [
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 22], mirror: true },
    ], tex, materials);
    const bones = skinModel(this.model);
    for (const part of ['head', 'arms', 'rightLeg', 'leftLeg']) this[part] = bones.get(this[part]);
    castShadows(this.model);
    this.built = true;
  }

  setStatus(status, itemName) {
    this.status = status;
    this.ring.material.color.set(STATUS_COLORS[status]);
    setSpriteItem(this.icon, itemName);
  }

  update(dt) {
    this.clock += dt;
    this.updateMovement(dt);
    const t = this.clock;
    this.icon.position.y = 2.5 + Math.sin(t * 3) * 0.08;
    if (!this.built) return;
    this.rightLeg.rotation.x = 0;
    this.leftLeg.rotation.x = 0;
    this.head.rotation.set(0, 0, 0);
    this.model.rotation.y = 0;
    if (this.moving) {
      this.walkCycle([this.rightLeg, this.leftLeg], null, 1);
    } else if (this.status === 'working') {
      // Le villageois s'affaire sur son bloc de métier : il hoche la tête et se tourne d'un côté puis de l'autre.
      this.head.rotation.x = 0.35 + Math.sin(t * 5) * 0.15;
      this.model.rotation.y = Math.sin(t * 1.3) * 0.4;
    } else {
      this.head.rotation.y = Math.sin(t * 0.7) * 0.3;
    }
  }
}

/**
 * Bord de chapeau des villageois (fermier, pêcheur…) : un plateau de 16 x 16 pixels.
 */
function hatRim(texture) {
  const geometry = new THREE.PlaneGeometry(16, 16);
  const uv = geometry.attributes.uv;
  const [u, v, size] = [31, 48, 16];
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (u + uv.getX(i) * size) / 64, 1 - (v + (1 - uv.getY(i)) * size) / 64);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
    map: texture,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 5.5;
  return mesh;
}
