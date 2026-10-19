import { WEATHER_REFRESH_MS } from '../config.mjs';
import { getSettings } from './settings.mjs';

// Météo réelle et heures du soleil (Open-Meteo, sans clé), pour la lumière, la pluie et la neige du village.
// Le lieu : la ville choisie dans les réglages, sinon celle du fuseau horaire de la machine (America/New_York → New York).

const API = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';

let current = null;
let place = null;

// Codes météo WMO regroupés en ce que le village sait dessiner.
function condition(code) {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 2) return 'cloudy';
  return 'clear';
}

function timezoneCity() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const city = zone.split('/').pop();
  return city && city !== 'UTC' ? city.replace(/_/g, ' ') : '';
}

/**
 * Coordonnées de la ville à suivre, retrouvées une fois par nom de ville.
 */
async function locate() {
  const name = (await getSettings()).city || timezoneCity();
  if (!name) return null;
  if (place?.name === name) return place;
  const params = new URLSearchParams({ name, count: '1', format: 'json' });
  const result = (await (await fetch(`${GEOCODING}?${params}`)).json()).results?.[0];
  place = result ? { name, latitude: result.latitude, longitude: result.longitude } : { name };
  return place;
}

async function refresh() {
  try {
    const where = await locate();
    if (where?.latitude == null) return;
    const params = new URLSearchParams({
      latitude: String(where.latitude),
      longitude: String(where.longitude),
      timezone: 'auto',
      current: 'weather_code,temperature_2m,precipitation,snowfall,cloud_cover,wind_speed_10m',
      daily: 'sunrise,sunset',
      forecast_days: '1',
    });
    const data = await (await fetch(`${API}?${params}`)).json();
    // Les heures arrivent en heure locale du lieu : on les remet en temps universel.
    const toTime = (local) => Date.parse(`${local}:00Z`) - data.utc_offset_seconds * 1000;
    current = {
      place: where.name,
      condition: condition(data.current.weather_code),
      code: data.current.weather_code,
      temperature: data.current.temperature_2m,
      precipitation: data.current.precipitation,
      cloudCover: data.current.cloud_cover,
      wind: data.current.wind_speed_10m,
      sunrise: toTime(data.daily.sunrise[0]),
      sunset: toTime(data.daily.sunset[0]),
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error('météo indisponible :', error.message);
  }
}

export function startWeather() {
  refresh();
  setInterval(refresh, WEATHER_REFRESH_MS);
}

/**
 * Nouvelle ville dans les réglages : on va chercher sa météo tout de suite.
 */
export function refreshWeather() {
  return refresh();
}

export function weatherNow() {
  return current;
}
