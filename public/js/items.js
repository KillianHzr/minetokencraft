import * as THREE from 'three';
import { itemTexture } from './textures.js';

// Objet tenu en main selon l'outil que Claude est en train d'utiliser.
const TOOL_ITEMS = {
  Bash: 'diamond_pickaxe',
  Edit: 'writable_book',
  Write: 'writable_book',
  MultiEdit: 'writable_book',
  NotebookEdit: 'writable_book',
  Read: 'book',
  Grep: 'compass_00',
  Glob: 'compass_00',
  WebSearch: 'spyglass',
  WebFetch: 'spyglass',
  Agent: 'bell',
  Task: 'bell',
  Skill: 'enchanted_book',
  TodoWrite: 'paper',
  AskUserQuestion: 'goat_horn',
  Artifact: 'painting',
  Workflow: 'redstone',
};

export const DONE_ITEM = 'emerald';
export const THINKING_ITEM = 'clock_00';

export function itemForTool(toolName) {
  if (!toolName) return null;
  if (TOOL_ITEMS[toolName]) return TOOL_ITEMS[toolName];
  if (toolName.startsWith('mcp__claude-in-chrome')) return 'ender_eye';
  if (toolName.startsWith('mcp__')) return 'redstone';
  return 'iron_sword';
}

const materials = new Map();
const spriteMaterials = new Map();

function itemMaterial(name) {
  if (!materials.has(name)) {
    const material = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
    itemTexture(name).then((texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    materials.set(name, material);
  }
  return materials.get(name);
}

function itemSpriteMaterial(name) {
  if (!spriteMaterials.has(name)) {
    const material = new THREE.SpriteMaterial({ alphaTest: 0.5, depthTest: false });
    itemTexture(name).then((texture) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    spriteMaterials.set(name, material);
  }
  return spriteMaterials.get(name);
}

const itemGeometry = new THREE.PlaneGeometry(1, 1);

/**
 * Objet plat tenu en main, de `size` blocs de côté.
 */
export function createItemMesh(size) {
  const mesh = new THREE.Mesh(itemGeometry, itemMaterial('stick'));
  mesh.scale.setScalar(size);
  mesh.visible = false;
  return mesh;
}

export function setItem(mesh, name) {
  mesh.visible = Boolean(name);
  if (name) mesh.material = itemMaterial(name);
}

/**
 * Icône flottante toujours tournée vers la caméra (au-dessus des villageois).
 */
export function createItemSprite(size) {
  const sprite = new THREE.Sprite(itemSpriteMaterial(DONE_ITEM));
  sprite.scale.setScalar(size);
  sprite.renderOrder = 10;
  sprite.visible = false;
  return sprite;
}

export function setSpriteItem(sprite, name) {
  sprite.visible = Boolean(name);
  if (name) sprite.material = itemSpriteMaterial(name);
}
