import * as THREE from 'three';
import { SITE } from './site.js';

export const TEXTURE_ROOT = SITE.textures;

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
      // Online demo: the images come from another site, which allows it; without this, WebGL would refuse them.
      image.crossOrigin = 'anonymous';
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
      // Animated Minecraft texture (frames stacked vertically): only the first one is shown.
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
 * Grayscale texture tinted the way Minecraft tints grass and foliage according to the biome.
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
      // The multiply also fills transparent pixels: restore the original alpha.
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(image, 0, 0);
      return pixelated(new THREE.CanvasTexture(canvas));
    }));
  }
  return textureCache.get(key);
}

/**
 * Overlays several layers of the same size (villager: body, biome, profession).
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
 * Player head (face + hat layer), as a data URL for the panel.
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
