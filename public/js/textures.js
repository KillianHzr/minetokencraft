import * as THREE from 'three';

export const TEXTURE_ROOT = '/assets/textures/';

const imageCache = new Map();
const textureCache = new Map();

export function pixelated(texture) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`image introuvable : ${url}`));
      image.src = url;
    }));
  }
  return imageCache.get(url);
}

export function loadTexture(url) {
  if (!textureCache.has(url)) {
    textureCache.set(url, loadImage(url).then((image) => {
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      // Texture animée de Minecraft (images empilées en hauteur) : on n'affiche que la première.
      if (image.height > image.width && image.height % image.width === 0) {
        texture.repeat.set(1, image.width / image.height);
        texture.offset.set(0, 1 - image.width / image.height);
      }
      return pixelated(texture);
    }));
  }
  return textureCache.get(url);
}

export const blockTexture = (name) => loadTexture(`${TEXTURE_ROOT}block/${name}.png`);
export const itemTexture = (name) => loadTexture(`${TEXTURE_ROOT}item/${name}.png`);

/**
 * Texture en niveaux de gris teintée comme Minecraft teinte l'herbe et le feuillage selon le biome.
 */
export function tintedTexture(name, color) {
  const key = `tint:${name}:${color}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, loadImage(`${TEXTURE_ROOT}block/${name}.png`).then((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      context.globalCompositeOperation = 'multiply';
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Le multiply remplit aussi les pixels transparents : on remet l'alpha d'origine.
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(image, 0, 0);
      return pixelated(new THREE.CanvasTexture(canvas));
    }));
  }
  return textureCache.get(key);
}

/**
 * Superpose plusieurs calques de même taille (villageois : corps, biome, métier).
 */
export function layeredTexture(urls) {
  const key = `layers:${urls.join('|')}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, Promise.all(urls.map(loadImage)).then((images) => {
      const canvas = document.createElement('canvas');
      canvas.width = images[0].width;
      canvas.height = images[0].height;
      const context = canvas.getContext('2d');
      for (const image of images) context.drawImage(image, 0, 0);
      return pixelated(new THREE.CanvasTexture(canvas));
    }));
  }
  return textureCache.get(key);
}

/**
 * Tête du joueur (visage + calque du chapeau), en data URL pour le panneau.
 */
export async function skinFace(url) {
  const key = `face:${url}`;
  if (!imageCache.has(key)) {
    imageCache.set(key, loadImage(url).then((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      context.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
      context.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
      return canvas.toDataURL();
    }));
  }
  return imageCache.get(key);
}
