import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Évite que le filtrage au plus proche n'attrape le pixel voisin sur les bords d'une face.
const UV_INSET = 0.01;

/**
 * Pavé texturé selon le patron des modèles Minecraft, en pixels de texture.
 * Le modèle regarde vers +z : son côté droit est en -x.
 * `from` est le coin minimal, `size` = [largeur x, hauteur y, profondeur z], `uv` le coin du patron dans la texture.
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

  // Coins vus de l'extérieur : haut gauche, haut droite, bas droite, bas gauche.
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
 * Membre articulé : un groupe placé sur son pivot, qui porte ses pavés.
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
 * Fusionne un modèle monté en groupes (un par articulation, avec ses pavés) en un seul maillage animé par os :
 * un appel de dessin par matériau au lieu d'un par pavé. Chaque groupe devient un os placé pareil, que le code
 * d'animation tourne comme avant. `keep` : objets à laisser tels quels (objet tenu en main), rattachés à leur os.
 * Renvoie l'os de chaque groupe.
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
  // Les membres bougent hors de la boîte calculée au repos : on ne laisse pas la caméra l'écarter à tort.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return boneOf;
}
