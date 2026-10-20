import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { TEXTURE_ROOT } from './textures.js';

// Sky, light, weather and seasons: everything that changes with the real time and the weather outside.

// Top and bottom of the sky gradient by weather, in full daylight; night and dawn blend into it.
const SKIES = {
  clear: ['#78a7ff', '#c6dcff'],
  cloudy: ['#8e9db4', '#c8d0dc'],
  rain: ['#66707f', '#99a2b0'],
  storm: ['#363d4b', '#59616f'],
  snow: ['#b4bfcd', '#e1e6ee'],
  fog: ['#b3b9c2', '#dadde2'],
};
const NIGHT_SKY = ['#070b22', '#1a2550'];
const GOLDEN_SKY = ['#f19a68', '#ffd6a0'];
// Veil over the scene: fog, light rain or flakes.
const VEILS = { clear: 0, cloudy: 0.04, rain: 0.12, storm: 0.2, snow: 0.14, fog: 0.38 };
// Light: weaker when overcast; at night, the moon lights in blue.
const OVERCAST = { clear: 1, cloudy: 0.8, rain: 0.65, storm: 0.5, snow: 0.75, fog: 0.7 };
// Night stays readable: the moon gives enough light to tell rooms and creatures apart.
const SUN = { dayIntensity: 0.9, moonIntensity: 0.38, sky: 0.58, nightSky: 0.28 };
const RAIN_DROPS = 1600;
const SNOW_FLAKES = 1100;
const RAIN_SPEED = 16;
const SNOW_SPEED = 1.3;
const SKY_HEIGHT = 14;
const LIGHTNING_MIN_S = 5;
const LIGHTNING_MAX_S = 14;
// Reference new moon (January 6, 2000, 18:14 UTC) and length of a lunar cycle.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const LUNAR_CYCLE_MS = 29.530588 * 24 * 60 * 60 * 1000;
const FALLING = { autumn: ['leafOrange', 'leafRed', 'leafYellow'], spring: ['petal'] };
const FALLING_RATE = 3;

const color = new THREE.Color();
const mix = (a, b, amount) => `#${color.set(a).lerp(new THREE.Color(b), amount).getHexString()}`;

function starsDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  for (let i = 0; i < 180; i++) {
    context.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`;
    const size = Math.random() < 0.15 ? 2 : 1;
    context.fillRect(Math.floor(Math.random() * 512), Math.floor(Math.random() * 256), size, size);
  }
  return canvas.toDataURL();
}

export class Environment {
  constructor(scene, { sky, veil, flash, hemisphere, sun }) {
    this.scene = scene;
    this.sky = sky;
    this.veil = veil;
    this.flash = flash;
    this.hemisphere = hemisphere;
    this.sun = sun;
    this.lightningIn = LIGHTNING_MIN_S;
    this.flashLeft = 0;
    this.fallingTimer = 0;
    sky.innerHTML = `<div class="sky__stars" style="background-image:url(${starsDataUrl()})"></div>
      <img class="sky__sun" src="${TEXTURE_ROOT}environment/sun.png" alt="">
      <div class="sky__moon" style="background-image:url(${TEXTURE_ROOT}environment/moon_phases.png)"></div>`;
    this.stars = sky.querySelector('.sky__stars');
    this.sunDisc = sky.querySelector('.sky__sun');
    this.moonDisc = sky.querySelector('.sky__moon');
    this.rain = this.makeRain();
    this.snow = this.makeSnow();
    scene.add(this.rain, this.snow);
  }

  makeRain() {
    const positions = new Float32Array(RAIN_DROPS * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#a9c4ff', transparent: true, opacity: 0.55 }));
    rain.frustumCulled = false;
    rain.visible = false;
    rain.userData.seeded = false;
    return rain;
  }

  makeSnow() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_FLAKES * 3), 3));
    const snow = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffffff', size: 3, sizeAttenuation: false }));
    snow.frustumCulled = false;
    snow.visible = false;
    snow.userData.seeded = false;
    return snow;
  }

  randomSpot(bounds) {
    return [
      bounds.x0 + Math.random() * (bounds.x1 - bounds.x0 + 1),
      Math.random() * SKY_HEIGHT,
      bounds.z0 + Math.random() * (bounds.z1 - bounds.z0 + 1),
    ];
  }

  updateRain(dt, bounds, wind) {
    const positions = this.rain.geometry.attributes.position.array;
    const slant = wind * 0.25;
    for (let i = 0; i < RAIN_DROPS; i++) {
      const at = i * 6;
      if (!this.rain.userData.seeded || positions[at + 1] < 0) {
        const [x, y, z] = this.randomSpot(bounds);
        positions[at] = x;
        positions[at + 1] = this.rain.userData.seeded ? SKY_HEIGHT : y;
        positions[at + 2] = z;
      } else {
        positions[at + 1] -= RAIN_SPEED * dt;
        positions[at] += RAIN_SPEED * slant * dt;
      }
      // A drop = a 0.6-block streak, slanted by the wind.
      positions[at + 3] = positions[at] - slant * 0.6;
      positions[at + 4] = positions[at + 1] + 0.6;
      positions[at + 5] = positions[at + 2];
    }
    this.rain.userData.seeded = true;
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  updateSnow(dt, bounds, wind, time) {
    const positions = this.snow.geometry.attributes.position.array;
    for (let i = 0; i < SNOW_FLAKES; i++) {
      const at = i * 3;
      if (!this.snow.userData.seeded || positions[at + 1] < 0) {
        const [x, y, z] = this.randomSpot(bounds);
        positions[at] = x;
        positions[at + 1] = this.snow.userData.seeded ? SKY_HEIGHT : y;
        positions[at + 2] = z;
      } else {
        positions[at + 1] -= SNOW_SPEED * dt;
        // Flakes swirl as they fall.
        positions[at] += (Math.sin(time / 900 + i) * 0.4 + wind * 0.6) * dt;
        positions[at + 2] += Math.cos(time / 1100 + i * 1.7) * 0.3 * dt;
      }
    }
    this.snow.userData.seeded = true;
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  updateSky(conditions, now) {
    const { condition, day, golden, course, night } = conditions;
    const [dayTop, dayBottom] = SKIES[condition] ?? SKIES.clear;
    const goldenAmount = golden * (condition === 'clear' || condition === 'cloudy' ? 0.85 : 0.35);
    const top = mix(mix(NIGHT_SKY[0], dayTop, day), GOLDEN_SKY[0], goldenAmount * day);
    const bottom = mix(mix(NIGHT_SKY[1], dayBottom, day), GOLDEN_SKY[1], goldenAmount * day);
    this.sky.style.background = `linear-gradient(${top}, ${bottom})`;
    const clearSky = condition === 'clear' || condition === 'cloudy';
    this.stars.style.opacity = clearSky ? (1 - day) * 0.9 : 0;
    // Sun and moon cross the upper sky, from the east (right) to the west (left).
    this.sunDisc.style.opacity = clearSky ? day : day * 0.25;
    this.sunDisc.style.left = `${88 - course * 76}%`;
    this.sunDisc.style.top = `${18 - Math.sin(course * Math.PI) * 12}%`;
    const phase = Math.floor((((now - NEW_MOON) % LUNAR_CYCLE_MS) / LUNAR_CYCLE_MS) * 8) % 8;
    this.moonDisc.style.backgroundPosition = `${-(phase % 4) * 100}% ${-Math.floor(phase / 4) * 100}%`;
    this.moonDisc.style.opacity = night && clearSky ? 1 : night ? 0.3 : 0;
    this.veil.style.opacity = VEILS[condition] ?? 0;
    this.veil.dataset.condition = condition;
  }

  updateLights(conditions) {
    const { condition, day, golden, course } = conditions;
    const overcast = OVERCAST[condition] ?? 1;
    this.hemisphere.intensity = (SUN.nightSky + (SUN.sky - SUN.nightSky) * day) * (0.85 + 0.15 * overcast);
    this.hemisphere.color.set(mix('#56669a', '#dcecff', day));
    // The sun by day, the moon by night (same light, weaker and bluer).
    const sunColor = mix('#fff1d6', '#ffb070', golden * 0.8);
    this.sun.color.set(mix('#9fb4ff', sunColor, day));
    this.sun.intensity = (SUN.moonIntensity + (SUN.dayIntensity - SUN.moonIntensity) * day) * overcast;
    const elevation = 0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, Math.max(0, course)));
    const sunDirection = new THREE.Vector3(0.9 - 1.8 * course, day > 0.05 ? elevation : 1, 0.5);
    return day > 0.05 ? sunDirection.normalize() : new THREE.Vector3(-0.3, 1, 0.6).normalize();
  }

  updateLightning(dt, conditions) {
    if (conditions.condition !== 'storm') {
      this.flash.style.opacity = 0;
      return;
    }
    this.lightningIn -= dt;
    if (this.lightningIn <= 0) {
      this.lightningIn = LIGHTNING_MIN_S + Math.random() * (LIGHTNING_MAX_S - LIGHTNING_MIN_S);
      this.flashLeft = 0.25;
    }
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    // Double flash: two close peaks.
    const strobe = this.flashLeft > 0.18 || (this.flashLeft > 0.04 && this.flashLeft < 0.1);
    this.flash.style.opacity = strobe ? 0.55 : 0;
    if (strobe) this.hemisphere.intensity += 1.2;
  }

  updateFalling(dt, conditions, bounds, particles) {
    const kinds = FALLING[conditions.season];
    if (!kinds) return;
    this.fallingTimer -= dt;
    if (this.fallingTimer > 0) return;
    this.fallingTimer = 1 / FALLING_RATE;
    // Leaves and petals fall from the trees at the back of the garden and drift with the wind.
    const origin = {
      x: bounds.x0 + Math.random() * (bounds.x1 - bounds.x0),
      y: 4 + Math.random() * 2,
      z: bounds.z0 + Math.random() * 3,
    };
    particles.emit(kinds[Math.floor(Math.random() * kinds.length)], origin, {
      spread: 1.5,
      velocity: [0.6 + conditions.wind, -0.7, 0.9],
      life: 6,
      size: 0.16,
    });
  }

  /**
   * Updates everything for the present moment; returns the direction of the sun (or the moon).
   */
  update(dt, conditions, layout, particles, now) {
    windUniforms.uTime.value += dt;
    windUniforms.uWind.value += (Math.max(0.15, conditions.wind) - windUniforms.uWind.value) * Math.min(1, dt);
    this.updateSky(conditions, now);
    const direction = this.updateLights(conditions);
    this.updateLightning(dt, conditions);
    const precipitation = conditions.condition === 'snow' ? 'snow' : ['rain', 'storm'].includes(conditions.condition) ? 'rain' : null;
    this.rain.visible = precipitation === 'rain';
    this.snow.visible = precipitation === 'snow';
    if (layout) {
      if (this.rain.visible) this.updateRain(dt, layout.weatherArea ?? layout.bounds, conditions.wind);
      if (this.snow.visible) this.updateSnow(dt, layout.weatherArea ?? layout.bounds, conditions.wind, now);
      this.updateFalling(dt, conditions, layout.bounds, particles);
    }
    return direction;
  }
}
