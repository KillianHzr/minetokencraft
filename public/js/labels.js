import * as THREE from 'three';

const projected = new THREE.Vector3();
const projectedRight = new THREE.Vector3();
const GAP = 3;
// Décalages essayés quand une étiquette en chevauche une autre, en fractions de sa largeur / hauteur.
const SHIFTS_X = [0, -0.4, 0.4, -0.8, 0.8];
const SHIFTS_Y = [0, -1, -2];
// Monter coûte plus cher que glisser : une étiquette doit rester au-dessus de son personnage.
const VERTICAL_COST = 1.6;
const WIDTH_TOLERANCE_PX = 2;

function overlap(a, b) {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Étiquettes HTML accrochées à des points de la scène.
 * - fixes (cartouches des pièces, panneaux des toits) : posées sur leur ancre, sans bouger ;
 * - mobiles : parmi quelques positions proches de leur ancre, la plus proche qui ne chevauche rien.
 * `span` (ancres gauche et droite) borne la largeur d'une étiquette fixe à celle de ce qu'elle titre (une pièce).
 */
export class Labels {
  constructor(container) {
    this.container = container;
    this.items = new Map();
  }

  upsert(id, anchor, html, className, priority, { align = 'center', fixed = false, span = null } = {}) {
    let item = this.items.get(id);
    if (!item) {
      const element = document.createElement('div');
      this.container.append(element);
      item = { element, html: null, className: null, maxWidth: null };
      this.items.set(id, item);
    }
    Object.assign(item, { anchor, priority, align, fixed, span });
    if (item.className !== className) {
      item.element.className = className;
      item.className = className;
      item.size = null;
    }
    if (item.html !== html) {
      item.element.innerHTML = html;
      item.html = html;
      item.size = null;
    }
  }

  keepOnly(ids) {
    for (const [id, item] of this.items) {
      if (!ids.has(id)) {
        item.element.remove();
        this.items.delete(id);
      }
    }
  }

  candidates(x, bottom, { w, h }, width) {
    const list = [];
    for (const sx of SHIFTS_X) {
      for (const sy of SHIFTS_Y) {
        const left = Math.min(Math.max(x - w / 2 + sx * w, 2), width - w - 2);
        // Une étiquette ne sort jamais par le haut de l'écran.
        const top = Math.max(bottom - h + sy * (h + GAP), 2);
        list.push({ x0: left, x1: left + w, y0: top, y1: top + h, cost: Math.abs(sx) + Math.abs(sy) * VERTICAL_COST });
      }
    }
    return list.sort((a, b) => a.cost - b.cost);
  }

  screen(object, camera, width, height, target) {
    object.getWorldPosition(target).project(camera);
    return { x: (target.x * 0.5 + 0.5) * width, y: (-target.y * 0.5 + 0.5) * height };
  }

  update(camera, width, height) {
    const placed = [];
    const items = [...this.items.values()].sort((a, b) => Number(b.fixed) - Number(a.fixed) || a.priority - b.priority);
    for (const item of items) {
      const point = this.screen(item.anchor, camera, width, height, projected);
      if (item.span) {
        const left = this.screen(item.span[0], camera, width, height, projectedRight).x;
        const maxWidth = Math.max(40, this.screen(item.span[1], camera, width, height, projectedRight).x - left);
        if (Math.abs(maxWidth - (item.maxWidth ?? 0)) > WIDTH_TOLERANCE_PX) {
          item.maxWidth = maxWidth;
          item.element.style.maxWidth = `${Math.round(maxWidth)}px`;
          item.size = null;
        }
      }
      item.size ??= { w: item.element.offsetWidth, h: item.element.offsetHeight };
      let box;
      if (item.fixed) {
        const left = item.align === 'top-left' ? point.x : point.x - item.size.w / 2;
        const top = item.align.startsWith('top') ? point.y : point.y - item.size.h;
        box = { x0: left, x1: left + item.size.w, y0: top, y1: top + item.size.h };
      } else {
        const options = this.candidates(point.x, point.y, item.size, width);
        box = options.find((option) => placed.every((other) => !overlap(option, other)));
        box ??= options.reduce((least, option) => {
          const covered = placed.reduce((sum, other) => sum + overlap(option, other), 0);
          return covered < least.covered ? { option, covered } : least;
        }, { option: options[0], covered: Infinity }).option;
      }
      placed.push(box);
      // On n'écrit dans le DOM que si l'étiquette a bougé : sinon le navigateur recalcule les styles à chaque image.
      const transform = `translate(${Math.round(box.x0)}px, ${Math.round(box.y0)}px)`;
      if (item.transform !== transform) {
        item.transform = transform;
        item.element.style.transform = transform;
      }
    }
  }
}
