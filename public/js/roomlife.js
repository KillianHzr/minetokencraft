import * as THREE from 'three';
import { mcBox } from './mcbox.js';
import { blockTexture, loadTexture, pixelated, TEXTURE_ROOT } from './textures.js';
import { createItemMesh, itemForTool, setItem } from './items.js';
import { STATIONS } from './layout.js';
import { hash } from './identity.js';

// The room lives with its session: a painting goes up on the back wall after an hour, item frames on the desks show
// the tools it uses the most, and chests pile up by the armchair as it edits files (one lid opens while it writes).

const PX = 1 / 16;
const PAINTING_AFTER_MS = 60 * 60 * 1000;
// Two-block paintings of the game, one per session.
const PAINTINGS = ['pool', 'courbet', 'sea', 'sunset', 'creebet'];
// Desks whose front face carries a frame, from the most used tool to the next.
const FRAMED_DESKS = ['carto', 'craft'];
const FRAME_SIZE = 0.75;
// File edits for each chest: the first one, a second at 20, a third at 60.
const CHEST_EDITS = [1, 20, 60];
const CHEST_SPOTS = [[2, 4], [3, 4], [4, 4]];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LID_OPEN = -0.6;

// Geometries and materials shared by every room: World.release() leaves objects marked `keepResources` alone.
let frameMaterial = null;
let chestMaterial = null;
let chestParts = null;
const paintingMaterials = new Map();
const paintingQuad = new THREE.PlaneGeometry(2, 1);
const frameQuad = new THREE.PlaneGeometry(FRAME_SIZE, FRAME_SIZE);

function paintingMaterial(name) {
  if (!paintingMaterials.has(name)) {
    const material = new THREE.MeshLambertMaterial();
    loadTexture(`${TEXTURE_ROOT}painting/${name}.png`).then((map) => {
      material.map = map;
      material.needsUpdate = true;
    });
    paintingMaterials.set(name, material);
  }
  return paintingMaterials.get(name);
}

/**
 * Chest as in the game: a 14-pixel base, a lid hinged at the back, a latch in front. The lid is its own group, to
 * open it.
 */
function chest() {
  if (!chestMaterial) {
    chestMaterial = new THREE.MeshLambertMaterial();
    loadTexture(`${TEXTURE_ROOT}entity/chest/normal.png`).then((map) => {
      chestMaterial.map = pixelated(map);
      chestMaterial.needsUpdate = true;
    });
  }
  const tex = [64, 64];
  chestParts ??= {
    base: mcBox({ from: [-7, 0, -7], size: [14, 10, 14], uv: [0, 19], tex }),
    lid: mcBox({ from: [-7, 0, 0], size: [14, 5, 14], uv: [0, 0], tex }),
    latch: mcBox({ from: [-1, -2, 14], size: [2, 4, 1], uv: [0, 0], tex }),
  };
  const root = new THREE.Group();
  root.scale.setScalar(PX);
  root.add(new THREE.Mesh(chestParts.base, chestMaterial));
  const lid = new THREE.Group();
  lid.position.set(0, 9, -7);
  lid.add(new THREE.Mesh(chestParts.lid, chestMaterial), new THREE.Mesh(chestParts.latch, chestMaterial));
  root.add(lid);
  root.userData.lid = lid;
  for (const mesh of [root.children[0], ...lid.children]) Object.assign(mesh, { castShadow: true, receiveShadow: true });
  return root;
}

/**
 * Item frame on the front of a desk: the frame, and the item it shows a hair in front of it.
 */
function itemFrame() {
  if (!frameMaterial) {
    frameMaterial = new THREE.MeshLambertMaterial({ alphaTest: 0.5 });
    blockTexture('item_frame').then((map) => {
      frameMaterial.map = map;
      frameMaterial.needsUpdate = true;
    });
  }
  const frame = new THREE.Group();
  frame.add(new THREE.Mesh(frameQuad, frameMaterial));
  const item = createItemMesh(FRAME_SIZE * 0.66);
  item.position.z = 0.01;
  frame.add(item);
  frame.userData.item = item;
  frame.visible = false;
  return frame;
}

/**
 * Builds the objects of a session's room, hidden until the session earns them, and returns their update.
 * `lamps`: the back wall shows task lamps, so the painting hangs lower, under them.
 */
export function roomLife(group, room, { lamps }) {
  const { x0, z0 } = room;
  const seed = hash(room.player.id);
  const painting = new THREE.Mesh(paintingQuad, paintingMaterial(PAINTINGS[seed % PAINTINGS.length]));
  painting.position.set(x0 + 4, lamps ? 0.55 : 1.5, z0 + 0.02);
  painting.receiveShadow = true;
  painting.visible = false;
  const frames = FRAMED_DESKS.map((desk) => {
    const frame = itemFrame();
    const [dx, dz] = STATIONS[desk].block;
    frame.position.set(x0 + dx + 0.5, 0.5, z0 + dz + 1.02);
    return frame;
  });
  const chests = CHEST_SPOTS.map(([dx, dz]) => {
    const box = chest();
    box.position.set(x0 + dx + 0.5, 0, z0 + dz + 0.5);
    box.visible = false;
    return box;
  });
  for (const object of [painting, ...frames, ...chests]) object.traverse((child) => (child.userData.keepResources = true));
  group.add(painting, ...frames, ...chests);
  const shown = { tools: '' };
  return {
    update(player, now = Date.now()) {
      painting.visible = player.startedAt != null && now - player.startedAt >= PAINTING_AFTER_MS;
      const tools = player.work?.tools ?? [];
      const key = tools.map((tool) => tool.name).join(',');
      if (key !== shown.tools) {
        shown.tools = key;
        frames.forEach((frame, index) => {
          const tool = tools[index];
          frame.visible = Boolean(tool);
          if (tool) setItem(frame.userData.item, itemForTool(tool.name));
        });
      }
      const edits = player.work?.edits ?? 0;
      const writing = player.status === 'working' && EDIT_TOOLS.has(player.tool?.name);
      let last = -1;
      chests.forEach((box, index) => {
        box.visible = edits >= CHEST_EDITS[index];
        if (box.visible) last = index;
      });
      // The newest chest opens while the session writes a file.
      chests.forEach((box, index) => {
        const lid = box.userData.lid;
        lid.rotation.x += ((writing && index === last ? LID_OPEN : 0) - lid.rotation.x) * 0.2;
      });
    },
  };
}
