import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Keeps nearest-neighbor filtering from grabbing the neighboring pixel on the edges of a face.
const UV_INSET = 0.01;

/**
 * Textured box following the Minecraft model layout, in texture pixels.
 * The model faces +z: its right side is at -x.
 * `from` is the minimal corner, `size` = [width x, height y, depth z], `uv` the corner of the layout in the texture.
 */
export function mcBox({ from, size, uv, tex, inflate = 0, mirror = false }) {
  const [w, h, d] = size;
  const [u, v] = uv;
  const [tw, th] = tex;
  const x0 = from[0] - inflate;
  const y0 = from[1] - inflate;
  const z0 = from[2] - inflate;
  const x1 = from[0] + w + inflate;
  const y1 = from[1] + h + inflate;
  const z1 = from[2] + d + inflate;
  const rightRect = [u, v + d, d, h];
  const leftRect = [u + d + w, v + d, d, h];

  // Corners seen from the outside: top left, top right, bottom right, bottom left.
  const faces = [
    { normal: [0, 0, 1], corners: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], rect: [u + d, v + d, w, h] },
    { normal: [0, 0, -1], corners: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], rect: [u + 2 * d + w, v + d, w, h] },
    { normal: [-1, 0, 0], corners: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], rect: mirror ? leftRect : rightRect },
    { normal: [1, 0, 0], corners: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], rect: mirror ? rightRect : leftRect },
    { normal: [0, 1, 0], corners: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], rect: [u + d, v, w, d] },
    { normal: [0, -1, 0], corners: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], rect: [u + d + w, v, w, d] },
  ];

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  faces.forEach(({ normal, corners, rect }, index) => {
    const [ru, rv, rw, rh] = rect;
    let left = (ru + UV_INSET) / tw;
    let right = (ru + rw - UV_INSET) / tw;
    const top = 1 - (rv + UV_INSET) / th;
    const bottom = 1 - (rv + rh - UV_INSET) / th;
    if (mirror) [left, right] = [right, left];
    const faceUvs = [[left, top], [right, top], [right, bottom], [left, bottom]];
    corners.forEach((corner, i) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(...faceUvs[i]);
    });
    const base = index * 4;
    indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Articulated limb: a group placed on its pivot, carrying its boxes.
 */
export function limb(parent, pivot, boxes, tex, materials) {
  const group = new THREE.Group();
  group.position.set(...pivot);
  for (const box of boxes) {
    if (!box) continue;
    const mesh = new THREE.Mesh(mcBox({ ...box, tex }), box.overlay ? materials.overlay : materials.base);
    group.add(mesh);
  }
  parent.add(group);
  return group;
}

/**
 * Merges a model built as groups (one per joint, with its boxes) into a single mesh animated by bones:
 * one draw call per material instead of one per box. Each group becomes a bone placed the same way, which the
 * animation code rotates as before. `keep`: objects to leave as they are (held item), attached to their bone.
 * Returns the bone of each group.
 */
export function skinModel(model, keep = []) {
  model.updateWorldMatrix(true, true);
  const toModel = model.matrixWorld.clone().invert();
  const root = new THREE.Bone();
  const bones = [root];
  const boneOf = new Map([[model, root]]);
  const byMaterial = new Map();
  const kept = [];
  const visit = (object) => {
    for (const child of object.children) {
      if (keep.includes(child)) {
        kept.push([child, boneOf.get(object)]);
      } else if (child.isMesh) {
        const geometry = child.geometry.clone().applyMatrix4(toModel.clone().multiply(child.matrixWorld));
        const count = geometry.attributes.position.count;
        const index = bones.indexOf(boneOf.get(object));
        geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, i) => (i % 4 === 0 ? index : 0)), 4));
        geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
        if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
        byMaterial.get(child.material).push(geometry);
      } else {
        const bone = new THREE.Bone();
        bone.position.copy(child.position);
        bone.quaternion.copy(child.quaternion);
        bone.scale.copy(child.scale);
        boneOf.get(object).add(bone);
        boneOf.set(child, bone);
        bones.push(bone);
        visit(child);
      }
    }
  };
  visit(model);
  const materials = [...byMaterial.keys()];
  const geometry = mergeGeometries(materials.map((material) => mergeGeometries(byMaterial.get(material))), true);
  for (const child of [...model.children]) model.remove(child);
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.add(root);
  model.add(mesh);
  mesh.updateWorldMatrix(true, true);
  mesh.bind(new THREE.Skeleton(bones));
  for (const [object, bone] of kept) bone.add(object);
  // Limbs move outside the box computed at rest: don't let the camera cull the mesh by mistake.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return boneOf;
}
