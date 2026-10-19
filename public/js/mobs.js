import * as THREE from 'three';
import { limb, skinModel } from './mcbox.js';
import { loadTexture, pixelated, TEXTURE_ROOT } from './textures.js';
import { castShadows, Entity, modelMaterials } from './entities.js';
import { ROOM_DEPTH } from './layout.js';

// Animaux le jour, monstres la nuit, un mélange des deux sous la pluie : ils se promènent dans le jardin
// et les allées, jamais dans les pièces.

const PX = 1 / 16;
const HALF_PI = Math.PI / 2;
const IDLE_MIN_S = 2;
const IDLE_MAX_S = 7;
const WANDER_RADIUS = 7;
const WANDER_TRIES = 10;
const SPAWN_STAGGER_S = 0.6;

// Combat : un clic frappe à l'épée en diamant (7 points de dégâts, comme dans le jeu). La créature rougit, recule,
// meurt en tombant sur le côté puis disparaît en fumée ; une autre la remplace 5 s plus tard.
const SWORD_DAMAGE = 7;
const RESPAWN_S = 5;
const HURT_S = 0.5;
const DEATH_S = 1;
const DEATH_FALL_S = 0.45;
const KNOCKBACK = 0.9;
const KNOCK_S = 0.22;
const KNOCK_HOP = 0.35;
// Les animaux frappés s'enfuient en courant.
const PANIC_S = 3;
const PANIC_SPEED = 2.2;
const HEALTH_BAR_S = 2.5;
// Marge autour de la créature pour la viser sans pixel près.
const HIT_SLACK = 0.25;
const HURT_COLOR = new THREE.Color(1, 0.35, 0.35);
const WHITE = new THREE.Color(1, 1, 1);

// Coordonnées des modèles Minecraft : y vers le bas depuis 24 (le sol), avant en -z. On les convertit.
const pivot = (x, y, z) => [x, 24 - y, -z];
const box = (u, v, x, y, z, w, h, d, extra = {}) => ({ uv: [u, v], from: [x, -(y + h), -(z + d)], size: [w, h, d], ...extra });

/**
 * Patron de chaque créature : texture, membres (pivot, pavés, rotation), pattes qui marchent, vitesse.
 */
const SPECIES = {
  pig: {
    texture: 'entity/pig/pig', tex: [64, 32], speed: 1.1, health: 10, passive: true,
    parts: {
      head: [pivot(0, 12, -6), [box(0, 0, -4, -4, -8, 8, 8, 8), box(16, 16, -2, 0, -9, 4, 3, 1)]],
      body: [pivot(0, 11, 2), [box(28, 8, -5, -10, -7, 10, 16, 8)], HALF_PI],
      leg1: [pivot(-3, 18, 7), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
      leg2: [pivot(3, 18, 7), [box(0, 16, -2, 0, -2, 4, 6, 4, { mirror: true })]],
      leg3: [pivot(-3, 18, -5), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
      leg4: [pivot(3, 18, -5), [box(0, 16, -2, 0, -2, 4, 6, 4, { mirror: true })]],
    },
  },
  cow: {
    texture: 'entity/cow/cow', tex: [64, 32], speed: 1, health: 10, passive: true,
    parts: {
      head: [pivot(0, 4, -8), [box(0, 0, -4, -4, -6, 8, 8, 6), box(22, 0, -5, -5, -4, 1, 3, 1), box(22, 0, 4, -5, -4, 1, 3, 1)]],
      body: [pivot(0, 5, 2), [box(18, 4, -6, -10, -7, 12, 18, 10), box(52, 0, -2, 2, -8, 4, 6, 1)], HALF_PI],
      leg1: [pivot(-4, 12, 7), [box(0, 16, -2, 0, -2, 4, 12, 4)]],
      leg2: [pivot(4, 12, 7), [box(0, 16, -2, 0, -2, 4, 12, 4, { mirror: true })]],
      leg3: [pivot(-4, 12, -6), [box(0, 16, -2, 0, -2, 4, 12, 4)]],
      leg4: [pivot(4, 12, -6), [box(0, 16, -2, 0, -2, 4, 12, 4, { mirror: true })]],
    },
  },
  sheep: {
    texture: 'entity/sheep/sheep', tex: [64, 32], speed: 1, health: 8, passive: true,
    // La laine est un second calque, un peu plus gros, avec sa propre texture.
    overlay: 'entity/sheep/sheep_fur',
    parts: {
      head: [pivot(0, 6, -8), [box(0, 0, -3, -4, -6, 6, 6, 8)], 0, [box(0, 0, -3, -4, -4, 6, 6, 6, { inflate: 0.6 })]],
      body: [pivot(0, 5, 2), [box(28, 8, -4, -10, -7, 8, 16, 6)], HALF_PI, [box(28, 8, -4, -10, -7, 8, 16, 6, { inflate: 1.75 })]],
      leg1: [pivot(-3, 12, 7), [box(0, 16, -2, 0, -2, 4, 12, 4)], 0, [box(0, 16, -2, 0, -2, 4, 6, 4, { inflate: 0.5 })]],
      leg2: [pivot(3, 12, 7), [box(0, 16, -2, 0, -2, 4, 12, 4, { mirror: true })], 0, [box(0, 16, -2, 0, -2, 4, 6, 4, { inflate: 0.5, mirror: true })]],
      leg3: [pivot(-3, 12, -5), [box(0, 16, -2, 0, -2, 4, 12, 4)], 0, [box(0, 16, -2, 0, -2, 4, 6, 4, { inflate: 0.5 })]],
      leg4: [pivot(3, 12, -5), [box(0, 16, -2, 0, -2, 4, 12, 4, { mirror: true })], 0, [box(0, 16, -2, 0, -2, 4, 6, 4, { inflate: 0.5, mirror: true })]],
    },
  },
  chicken: {
    texture: 'entity/chicken', tex: [64, 32], speed: 1.2, legs: ['leg1', 'leg2'], health: 4, passive: true,
    parts: {
      head: [pivot(0, 15, -4), [box(0, 0, -2, -6, -2, 4, 6, 3), box(14, 0, -2, -4, -4, 4, 2, 2), box(14, 4, -1, -2, -3, 2, 2, 2)]],
      body: [pivot(0, 16, 0), [box(0, 9, -3, -4, -3, 6, 8, 6)], HALF_PI],
      leg1: [pivot(-2, 19, 1), [box(26, 0, -1, 0, -3, 3, 5, 3)]],
      leg2: [pivot(1, 19, 1), [box(26, 0, -1, 0, -3, 3, 5, 3)]],
      wing1: [pivot(-4, 13, 0), [box(24, 13, 0, 0, -3, 1, 4, 6)]],
      wing2: [pivot(4, 13, 0), [box(24, 13, -1, 0, -3, 1, 4, 6)]],
    },
  },
  zombie: {
    texture: 'entity/zombie/zombie', tex: [64, 64], speed: 1.2, legs: ['leg1', 'leg2'], armsForward: true, health: 20,
    parts: {
      head: [pivot(0, 0, 0), [box(0, 0, -4, -8, -4, 8, 8, 8), box(32, 0, -4, -8, -4, 8, 8, 8, { inflate: 0.5, overlay: true })]],
      body: [pivot(0, 0, 0), [box(16, 16, -4, 0, -2, 8, 12, 4)]],
      arm1: [pivot(-5, 2, 0), [box(40, 16, -3, -2, -2, 4, 12, 4)]],
      arm2: [pivot(5, 2, 0), [box(40, 16, -1, -2, -2, 4, 12, 4, { mirror: true })]],
      leg1: [pivot(-1.9, 12, 0), [box(0, 16, -2, 0, -2, 4, 12, 4)]],
      leg2: [pivot(1.9, 12, 0), [box(0, 16, -2, 0, -2, 4, 12, 4, { mirror: true })]],
    },
  },
  skeleton: {
    texture: 'entity/skeleton/skeleton', tex: [64, 32], speed: 1.2, legs: ['leg1', 'leg2'], health: 20,
    parts: {
      head: [pivot(0, 0, 0), [box(0, 0, -4, -8, -4, 8, 8, 8), box(32, 0, -4, -8, -4, 8, 8, 8, { inflate: 0.5, overlay: true })]],
      body: [pivot(0, 0, 0), [box(16, 16, -4, 0, -2, 8, 12, 4)]],
      arm1: [pivot(-5, 2, 0), [box(40, 16, -1, -2, -1, 2, 12, 2)]],
      arm2: [pivot(5, 2, 0), [box(40, 16, -1, -2, -1, 2, 12, 2, { mirror: true })]],
      leg1: [pivot(-2, 12, 0), [box(0, 16, -1, 0, -1, 2, 12, 2)]],
      leg2: [pivot(2, 12, 0), [box(0, 16, -1, 0, -1, 2, 12, 2, { mirror: true })]],
    },
  },
  creeper: {
    texture: 'entity/creeper/creeper', tex: [64, 32], speed: 1.1, health: 20,
    parts: {
      head: [pivot(0, 6, 0), [box(0, 0, -4, -8, -4, 8, 8, 8)]],
      body: [pivot(0, 6, 0), [box(16, 16, -4, 0, -2, 8, 12, 4)]],
      leg1: [pivot(-2, 18, 4), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
      leg2: [pivot(2, 18, 4), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
      leg3: [pivot(-2, 18, -4), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
      leg4: [pivot(2, 18, -4), [box(0, 16, -2, 0, -2, 4, 6, 4)]],
    },
  },
  spider: {
    texture: 'entity/spider/spider', tex: [64, 32], speed: 1.7, legs: [], spider: true, health: 16,
    parts: {
      head: [pivot(0, 15, -3), [box(32, 4, -4, -4, -8, 8, 8, 8)]],
      neck: [pivot(0, 15, 0), [box(0, 0, -3, -3, -3, 6, 6, 6)]],
      body: [pivot(0, 15, 9), [box(0, 12, -5, -4, -6, 10, 8, 12)]],
      ...Object.fromEntries([2, 1, 0, -1].flatMap((z, index) => [
        [`right${index}`, [pivot(-4, 15, z), [box(18, 0, -15, -1, -1, 16, 2, 2)]]],
        [`left${index}`, [pivot(4, 15, z), [box(18, 0, -1, -1, -1, 16, 2, 2)]]],
      ])),
    },
  },
};

// Créatures des dimensions : présentes jour et nuit dans une aile passée au Nether ou à l'End.
const humanoidLimbs = {
  body: [pivot(0, 0, 0), [box(16, 16, -4, 0, -2, 8, 12, 4), box(16, 32, -4, 0, -2, 8, 12, 4, { inflate: 0.25, overlay: true })]],
  arm1: [pivot(-5, 2, 0), [box(40, 16, -3, -2, -2, 4, 12, 4)]],
  arm2: [pivot(5, 2, 0), [box(32, 48, -1, -2, -2, 4, 12, 4)]],
  leg1: [pivot(-1.9, 12, 0), [box(0, 16, -2, 0, -2, 4, 12, 4)]],
  leg2: [pivot(1.9, 12, 0), [box(16, 48, -2, 0, -2, 4, 12, 4)]],
};
// Tête de piglin : plus large, groin, défenses et oreilles tombantes.
const piglinHead = {
  head: [pivot(0, 0, 0), [
    box(0, 0, -5, -8, -4, 10, 8, 8),
    box(31, 1, -2, -4, -5, 4, 4, 1),
    box(2, 4, 2, -2, -5, 1, 2, 1),
    box(2, 0, -3, -2, -5, 1, 2, 1),
  ]],
  earLeft: [pivot(4.5, -6, 0), [box(51, 6, 0, 0, -2, 1, 5, 4)], 0, null, -0.52],
  earRight: [pivot(-4.5, -6, 0), [box(39, 6, -1, 0, -2, 1, 5, 4)], 0, null, 0.52],
};

Object.assign(SPECIES, {
  piglin: { texture: 'entity/piglin/piglin', tex: [64, 64], speed: 1.2, legs: ['leg1', 'leg2'], health: 16, parts: { ...piglinHead, ...humanoidLimbs } },
  zombifiedPiglin: {
    texture: 'entity/piglin/zombified_piglin', tex: [64, 64], speed: 1.1, legs: ['leg1', 'leg2'], armsForward: true, health: 20,
    parts: { ...piglinHead, ...humanoidLimbs },
  },
  // Blaze : une tête qui flotte, entourée de douze bâtons qui tournent sur trois anneaux.
  blaze: {
    texture: 'entity/blaze', tex: [64, 32], speed: 0.9, legs: [], rods: 12, health: 20,
    parts: {
      head: [pivot(0, 0, 0), [box(0, 0, -4, -4, -4, 8, 8, 8)]],
      ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`rod${index}`, [pivot(0, 24, 0), [box(0, 16, -1, -4, -1, 2, 8, 2)]]])),
    },
  },
  // Ghast : un grand cube blanc qui flotte au-dessus de l'aile, ses tentacules qui pendent.
  ghast: {
    texture: 'entity/ghast/ghast', tex: [64, 32], speed: 0.8, legs: [], flying: true, scale: 2, health: 10,
    parts: {
      body: [pivot(0, 0, 0), [box(0, 0, -8, -8, -8, 16, 16, 16)]],
      ...Object.fromEntries([[-5, -5], [0, -5], [5, -5], [-5, 0], [0, 0], [5, 0], [-5, 5], [0, 5], [5, 5]].map(([x, z], index) => [
        `tentacle${index}`, [pivot(x, 8, z), [box(0, 0, -1, 0, -1, 2, 7 + (index * 5) % 8, 2)]],
      ])),
    },
  },
  // Enderman : très grand, bras et jambes interminables, yeux violets qui brillent dans le noir. Frappé, il se téléporte.
  enderman: {
    texture: 'entity/enderman/enderman', tex: [64, 32], speed: 1, legs: ['leg1', 'leg2'], glow: 'entity/enderman/enderman_eyes', health: 40, teleports: true,
    parts: {
      head: [pivot(0, -14, 0), [box(0, 0, -4, -8, -4, 8, 8, 8)], 0, [box(0, 0, -4, -8, -4, 8, 8, 8, { inflate: 0.05 })]],
      body: [pivot(0, -14, 0), [box(32, 16, -4, 0, -2, 8, 12, 4)]],
      arm1: [pivot(-5, -12, 0), [box(56, 0, -1, -2, -1, 2, 30, 2)]],
      arm2: [pivot(5, -12, 0), [box(56, 0, -1, -2, -1, 2, 30, 2, { mirror: true })]],
      leg1: [pivot(-2, -6, 0), [box(56, 0, -1, 0, -1, 2, 30, 2)]],
      leg2: [pivot(2, -6, 0), [box(56, 0, -1, 0, -1, 2, 30, 2, { mirror: true })]],
    },
  },
});

const DAY_MOBS = ['pig', 'cow', 'sheep', 'chicken', 'pig', 'sheep', 'chicken'];
const NIGHT_MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'zombie', 'skeleton'];
const RAIN_MOBS = ['pig', 'zombie', 'cow', 'creeper', 'sheep', 'skeleton'];
const DIMENSION_MOBS = {
  nether: ['zombifiedPiglin', 'piglin', 'zombifiedPiglin', 'blaze', 'ghast'],
  end: ['enderman', 'enderman', 'enderman'],
};
const GHAST_HEIGHT = 7;
// Les créatures du Nether et de l'End brillent un peu dans la pénombre de leur dimension.
const GLOW_INTENSITY = 0.9;

class Mob extends Entity {
  constructor(kind) {
    super(1.5);
    this.kind = kind;
    this.species = SPECIES[kind];
    this.speed = this.species.speed;
    this.model.scale.setScalar(PX * (this.species.scale ?? 1));
    this.idle = Math.random() * IDLE_MAX_S;
    this.health = this.species.health;
    this.hurtTime = 0;
    this.panic = 0;
    this.dying = null;
    this.knock = null;
    Promise.all([
      loadTexture(`${TEXTURE_ROOT}${this.species.texture}.png`),
      this.species.overlay ? loadTexture(`${TEXTURE_ROOT}${this.species.overlay}.png`) : null,
      this.species.glow ? loadTexture(`${TEXTURE_ROOT}${this.species.glow}.png`) : null,
    ]).then(([texture, overlay, glow]) => this.build(texture, overlay ?? glow, Boolean(glow)));
  }

  build(texture, overlayTexture, glowing) {
    const materials = modelMaterials(texture);
    const overlayMaterials = overlayTexture && modelMaterials(overlayTexture);
    this.materials = [materials, overlayMaterials].filter(Boolean).flatMap(Object.values);
    if (glowing) Object.assign(overlayMaterials.overlay, { emissive: new THREE.Color(0xffffff), emissiveMap: overlayTexture, emissiveIntensity: GLOW_INTENSITY });
    if (this.species.rods) Object.assign(materials.base, { emissive: new THREE.Color(0xffffff), emissiveMap: texture, emissiveIntensity: 0.35 });
    this.parts = {};
    for (const [name, [at, boxes, rotation = 0, overlayBoxes, rotationZ = 0]] of Object.entries(this.species.parts)) {
      const part = limb(this.model, at, boxes, this.species.tex, materials);
      // Calque à part (laine du mouton, yeux de l'enderman), découpé selon sa transparence.
      if (overlayBoxes && overlayMaterials) {
        limb(part, [0, 0, 0], overlayBoxes, this.species.tex, { base: overlayMaterials.overlay, overlay: overlayMaterials.overlay });
      }
      part.rotation.x = rotation;
      part.rotation.z = rotationZ;
      this.parts[name] = part;
    }
    if (this.species.spider) {
      // Pattes d'araignée : écartées en éventail et pliées vers le sol.
      [0.6, 0.25, -0.25, -0.6].forEach((fan, index) => {
        this.parts[`right${index}`].rotation.set(0, -fan, 0.6);
        this.parts[`left${index}`].rotation.set(0, fan, -0.6);
      });
    }
    if (this.species.armsForward) {
      this.parts.arm1.rotation.x = -HALF_PI;
      this.parts.arm2.rotation.x = -HALF_PI;
    }
    const bones = skinModel(this.model);
    for (const name of Object.keys(this.parts)) this.parts[name] = bones.get(this.parts[name]);
    castShadows(this.model);
    this.built = true;
  }

  /**
   * Coup d'épée : dégâts, teinte rouge, recul (`push`, déjà vérifié par le troupeau) ; vrai si le coup tue.
   */
  hurt(push) {
    this.health -= SWORD_DAMAGE;
    this.hurtTime = HURT_S;
    this.tint(HURT_COLOR);
    this.showHealth();
    if (this.health <= 0) {
      this.dying = DEATH_S;
      this.target.copy(this.root.position);
      return true;
    }
    if (push) this.knock = { velocity: push.clone().divideScalar(KNOCK_S), left: KNOCK_S };
    if (this.species.passive) this.panic = PANIC_S;
    return false;
  }

  tint(color) {
    for (const material of this.materials ?? []) material.color.copy(color);
  }

  /**
   * Barre de vie au-dessus de la tête, quelques secondes après chaque coup.
   */
  showHealth() {
    if (!this.healthBar) {
      const canvas = document.createElement('canvas');
      canvas.width = 22;
      canvas.height = 4;
      const texture = pixelated(new THREE.CanvasTexture(canvas));
      this.healthBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      this.healthBar.renderOrder = 10;
      this.healthBar.scale.set(1.6, 0.34, 1);
      const box = new THREE.Box3().setFromObject(this.model);
      this.healthBar.position.y = (box.max.y - this.root.position.y) / this.root.scale.y + 0.35;
      this.root.add(this.healthBar);
    }
    const canvas = this.healthBar.material.map.image;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#4a0d0d';
    context.fillRect(1, 1, canvas.width - 2, canvas.height - 2);
    context.fillStyle = '#e8312a';
    context.fillRect(1, 1, Math.max(0, Math.round((canvas.width - 2) * this.health / this.species.health)), canvas.height - 2);
    this.healthBar.material.map.needsUpdate = true;
    this.healthBar.visible = true;
    this.healthLeft = HEALTH_BAR_S;
  }

  updateCombat(dt) {
    if (this.hurtTime > 0) {
      this.hurtTime -= dt;
      if (this.hurtTime <= 0 && this.dying === null) this.tint(WHITE);
    }
    if (this.healthBar) {
      this.healthLeft -= dt;
      this.healthBar.visible = this.healthLeft > 0;
    }
    this.panic = Math.max(0, this.panic - dt);
    this.speed = this.species.speed * (this.panic > 0 ? PANIC_SPEED : 1);
    if (this.knock) {
      const step = Math.min(dt, this.knock.left);
      this.root.position.addScaledVector(this.knock.velocity, step);
      this.knock.left -= step;
      this.target.set(this.root.position.x, this.target.y, this.root.position.z);
      this.posture.position.y = Math.sin((1 - this.knock.left / KNOCK_S) * Math.PI) * KNOCK_HOP;
      if (this.knock.left <= 0) {
        this.knock = null;
        this.posture.position.y = 0;
      }
    }
  }

  update(dt) {
    this.clock += dt;
    this.updateCombat(dt);
    if (this.dying !== null) {
      // Mort à la Minecraft : la créature bascule sur le côté, toute rouge, puis part en fumée.
      this.dying -= dt;
      this.posture.rotation.z = Math.min(1, (DEATH_S - this.dying) / DEATH_FALL_S) * HALF_PI;
      this.dead = this.dying <= 0;
      return;
    }
    this.updateMovement(dt);
    if (!this.built) return;
    const t = this.clock;
    const legs = this.species.legs ?? ['leg1', 'leg2', 'leg3', 'leg4'];
    const swing = this.moving ? Math.sin(t * 7) * 0.6 : 0;
    legs.forEach((name, index) => {
      const part = this.parts[name];
      if (part) part.rotation.x = (index % 3 === 0 ? swing : -swing);
    });
    if (this.species.spider) {
      const crawl = this.moving ? Math.sin(t * 12) * 0.25 : 0;
      for (let index = 0; index < 4; index++) {
        this.parts[`right${index}`].rotation.y = -[0.6, 0.25, -0.25, -0.6][index] + (index % 2 ? crawl : -crawl);
        this.parts[`left${index}`].rotation.y = [0.6, 0.25, -0.25, -0.6][index] + (index % 2 ? -crawl : crawl);
      }
    }
    if (this.parts.wing1 && this.moving) {
      this.parts.wing1.rotation.z = Math.abs(Math.sin(t * 14)) * 0.6;
      this.parts.wing2.rotation.z = -Math.abs(Math.sin(t * 14)) * 0.6;
    }
    if (this.species.rods) {
      // Trois anneaux de quatre bâtons, à des hauteurs et des vitesses différentes.
      for (let index = 0; index < this.species.rods; index++) {
        const ring = Math.floor(index / 4);
        const angle = t * [1.6, -1.2, 2][ring] + (index % 4) * HALF_PI + ring * 0.4;
        const radius = [9, 7, 5][ring];
        this.parts[`rod${index}`].position.set(Math.cos(angle) * radius, [22, 14, 6][ring] + Math.sin(t * 2 + index) * 1.5, Math.sin(angle) * radius);
      }
      this.model.position.y = 4 + Math.sin(t * 1.5) * 2;
    }
    if (this.species.flying) {
      this.root.position.y = GHAST_HEIGHT + Math.sin(t * 0.7) * 0.4;
      for (let index = 0; index < 9; index++) this.parts[`tentacle${index}`].rotation.x = Math.sin(t * 1.4 + index) * 0.35;
    }
    // La tête regarde autour quand la créature ne bouge pas.
    if (this.parts.head && !this.moving && !this.species.rods) this.parts.head.rotation.y = Math.sin(t * 0.6) * 0.4;
  }
}

/**
 * Cases où l'on peut marcher dans les zones d'un thème (normal, Nether, End) : jardin et allées,
 * hors pièces, portails et rangée des troncs.
 */
function walkableCells(layout, theme) {
  const { bounds } = layout;
  const zones = layout.wings.filter((wing) => wing.theme === theme).map((wing) => wing.zone);
  const blocked = (x, z) => layout.wings.some((wing) => wing.rows.some((row) => x >= row.x0 && x <= row.x1 && z >= row.back && z <= row.z0 + ROOM_DEPTH))
    || layout.wings.some((wing) => wing.portals && x >= wing.portals.x0 && x <= wing.portals.x0 + 6 && z >= 0 && z <= 9)
    || z <= bounds.z0 + 2;
  const cells = new Set();
  for (const zone of zones) {
    for (let x = Math.max(bounds.x0 + 1, zone.x0); x <= Math.min(bounds.x1 - 1, zone.x1); x++) {
      for (let z = bounds.z0 + 1; z < bounds.z1; z++) if (!blocked(x, z)) cells.add(`${x},${z}`);
    }
  }
  return cells;
}

/**
 * Les créatures d'un thème : leurs cases, leur composition du moment, celles en attente d'apparition.
 */
class Group {
  constructor(theme) {
    this.theme = theme;
    this.cells = new Set();
    this.mobs = [];
    this.queue = [];
    // Créatures tuées, en attente de leur remplaçante.
    this.respawns = [];
    this.composition = null;
    this.timer = 0;
  }
}

export class Herd {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.groups = new Map();
    this.signature = null;
  }

  poof(position) {
    this.particles.emit('poof', { x: position.x, y: position.y + 0.6, z: position.z }, { count: 10, spread: 0.6, velocity: [0, 0.6, 0], life: 0.7, size: 0.2 });
  }

  remove(mob) {
    this.poof(mob.root.position);
    this.scene.remove(mob.root);
  }

  randomCell(group) {
    const cells = [...group.cells];
    if (!cells.length) return null;
    const [x, z] = cells[Math.floor(Math.random() * cells.length)].split(',').map(Number);
    return { x: x + 0.5, z: z + 0.5 };
  }

  clearPath(group, from, to) {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    for (let step = 0; step <= distance; step += 0.4) {
      const ratio = distance ? step / distance : 0;
      if (!group.cells.has(`${Math.floor(from.x + (to.x - from.x) * ratio)},${Math.floor(from.z + (to.z - from.z) * ratio)}`)) return false;
    }
    return true;
  }

  wander(group, mob) {
    // Le ghast survole son aile : il peut aller n'importe où au-dessus.
    if (mob.species.flying) {
      const spot = this.randomCell(group);
      if (spot) mob.moveTo(spot.x, mob.root.position.y, spot.z);
      return;
    }
    const from = mob.root.position;
    for (let attempt = 0; attempt < WANDER_TRIES; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = 1 + Math.random() * WANDER_RADIUS;
      const to = { x: from.x + Math.cos(angle) * reach, z: from.z + Math.sin(angle) * reach };
      if (this.clearPath(group, from, to)) {
        mob.moveTo(to.x, 0, to.z);
        return;
      }
    }
  }

  refreshGroups(layout) {
    const themes = new Set(layout.wings.map((wing) => wing.theme));
    themes.add('normal');
    for (const [theme, group] of this.groups) {
      if (themes.has(theme)) continue;
      group.mobs.forEach((mob) => this.remove(mob));
      this.groups.delete(theme);
    }
    for (const theme of themes) {
      const group = this.groups.get(theme) ?? new Group(theme);
      this.groups.set(theme, group);
      group.cells = walkableCells(layout, theme);
      // Une créature restée hors de ses cases (la maison ou les thèmes ont changé) disparaît.
      group.mobs = group.mobs.filter((mob) => {
        const keep = group.cells.has(`${Math.floor(mob.root.position.x)},${Math.floor(mob.root.position.z)}`);
        if (!keep) this.remove(mob);
        return keep;
      });
      this.refill(group);
    }
  }

  // Remet en file les créatures qui manquent à la composition : celles qui viennent de disparaître, ou toute la
  // population quand une aile revient du Nether ou de l'End et que le groupe retrouve des cases.
  refill(group) {
    if (!group.composition || !group.cells.size) return;
    const missing = [...group.composition];
    for (const kind of [...group.mobs.map((mob) => mob.kind), ...group.respawns.map((respawn) => respawn.kind)]) {
      const index = missing.indexOf(kind);
      if (index >= 0) missing.splice(index, 1);
    }
    group.queue = missing;
  }

  /**
   * Créature sous le rayon de la souris, la plus proche de la caméra.
   */
  mobAt(ray) {
    let best = null;
    for (const group of this.groups.values()) {
      for (const mob of group.mobs) {
        if (!mob.built || mob.dying !== null) continue;
        const point = ray.intersectBox(new THREE.Box3().setFromObject(mob.model).expandByScalar(HIT_SLACK), new THREE.Vector3());
        const distance = point?.distanceTo(ray.origin);
        if (point && (!best || distance < best.distance)) best = { mob, group, distance };
      }
    }
    return best;
  }

  /**
   * Coup d'épée sur la créature visée : elle recule dans l'axe du regard, si la case d'arrivée est praticable.
   */
  hit({ mob, group }, ray) {
    const position = mob.root.position;
    const push = new THREE.Vector3(ray.direction.x, 0, ray.direction.z).setLength(KNOCKBACK);
    const landing = `${Math.floor(position.x + push.x)},${Math.floor(position.z + push.z)}`;
    const center = { x: position.x, y: position.y + 0.8, z: position.z };
    this.particles.emit('crit', center, { count: 6, spread: 0.5, velocity: [0, 1.2, 0], life: 0.5, size: 0.14, gravity: 3 });
    this.particles.emit('damage', center, { count: 2, spread: 0.3, velocity: [0, 0.9, 0], life: 0.8, size: 0.2 });
    const killed = mob.hurt(mob.species.flying || group.cells.has(landing) ? push : null);
    if (killed || !mob.species.teleports) return;
    const spot = this.randomCell(group);
    if (!spot) return;
    this.particles.emit('portal', center, { count: 12, spread: 0.8, velocity: [0, 0.5, 0], life: 0.9, size: 0.16 });
    mob.knock = null;
    mob.placeAt(spot.x, 0, spot.z);
    this.particles.emit('portal', { x: spot.x, y: 1, z: spot.z }, { count: 12, spread: 0.8, velocity: [0, 0.5, 0], life: 0.9, size: 0.16 });
  }

  bury(group, mob) {
    const { x, y, z } = mob.root.position;
    this.particles.emit('poof', { x, y: y + 0.4, z }, { count: 16, spread: 0.9, velocity: [0, 0.8, 0], life: 0.9, size: 0.25 });
    this.particles.emit('xp', { x, y: y + 0.3, z }, { count: 3, spread: 0.5, velocity: [0, 1.6, 0], life: 1.2, size: 0.16, gravity: 3 });
    this.scene.remove(mob.root);
    group.mobs.splice(group.mobs.indexOf(mob), 1);
    group.respawns.push({ kind: mob.kind, left: RESPAWN_S });
  }

  /**
   * Met la population à jour : nouveau plan, nouvelle heure ou nouvelle météo.
   */
  update(dt, conditions, layout) {
    if (layout.signature !== this.signature) {
      this.signature = layout.signature;
      this.refreshGroups(layout);
    }
    const raining = ['rain', 'storm', 'snow'].includes(conditions.condition);
    for (const group of this.groups.values()) {
      const composition = DIMENSION_MOBS[group.theme] ?? (conditions.night ? NIGHT_MOBS : raining ? RAIN_MOBS : DAY_MOBS);
      if (composition !== group.composition) {
        group.composition = composition;
        group.mobs.forEach((mob) => this.remove(mob));
        group.mobs = [];
        group.respawns = [];
        this.refill(group);
      }
      group.respawns = group.respawns.filter((respawn) => {
        respawn.left -= dt;
        if (respawn.left > 0) return true;
        group.queue.push(respawn.kind);
        return false;
      });
      group.timer -= dt;
      if (group.queue.length && group.timer <= 0) {
        group.timer = SPAWN_STAGGER_S;
        const spot = this.randomCell(group);
        if (spot) {
          const mob = new Mob(group.queue.shift());
          mob.placeAt(spot.x, mob.species.flying ? GHAST_HEIGHT : 0, spot.z);
          mob.root.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(mob.root);
          this.poof(mob.root.position);
          group.mobs.push(mob);
        }
      }
      for (const mob of [...group.mobs]) {
        mob.update(dt);
        if (mob.dead) this.bury(group, mob);
        if (mob.dying !== null || mob.knock || mob.moving) continue;
        mob.idle -= dt;
        // Un animal qui vient d'être frappé repart aussitôt ailleurs.
        if (mob.idle <= 0 || mob.panic > 0) {
          mob.idle = IDLE_MIN_S + Math.random() * (IDLE_MAX_S - IDLE_MIN_S);
          mob.restYaw = mob.root.rotation.y;
          this.wander(group, mob);
        }
      }
    }
  }
}
