import { WEATHER_REFRESH_MS } from '../config.mjs';
import { getSettings } from './settings.mjs';

// Real weather and sun hours (Open-Meteo, no key), for the village light, rain and snow.
// The location: the city chosen in the settings, otherwise the one of the machine's time zone (America/New_York → New York).

const API = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';

// Rain over the last two hours, in millimeters, enough for a rainbow once the sky clears.
const RAINBOW_RAIN_MM = 0.2;

/**
 * Rain that fell over the hours before now.
 */
function recentRain(data, toTime) {
  const { time = [], precipitation = [] } = data.hourly ?? {};
  return time.reduce((sum, local, index) => (toTime(local) <= Date.now() ? sum + (precipitation[index] ?? 0) : sum), 0);
}

// After a failure (no network yet at login, for example), try again sooner than the usual refresh.
const RETRY_MS = 60 * 1000;

let current = null;
let place = null;
let retry = null;

// WMO weather codes grouped into what the village can draw.
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
 * Coordinates of the city to follow, looked up once per city name.
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
      // The last two hours of rain: a clear sky just after rain shows a rainbow.
      hourly: 'precipitation',
      past_hours: '2',
      forecast_hours: '1',
    });
    const response = await fetch(`${API}?${params}`);
    const data = await response.json();
    if (!response.ok || !data.current) throw new Error(data.reason ?? `answer ${response.status}`);
    // Times arrive in the location's local time: we convert them back to universal time.
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
      rainedRecently: recentRain(data, toTime) >= RAINBOW_RAIN_MM,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error('weather unavailable:', error.message);
    clearTimeout(retry);
    retry = setTimeout(refresh, RETRY_MS);
  }
}

export function startWeather() {
  refresh();
  setInterval(refresh, WEATHER_REFRESH_MS);
}

/**
 * New city in the settings: fetch its weather right away.
 */
export function refreshWeather() {
  return refresh();
}

export function weatherNow() {
  return current;
}
