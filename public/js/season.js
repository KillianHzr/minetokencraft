// Current conditions for the scenery: season, time of day (sun and moon), real weather.

const MINUTE = 60 * 1000;
// Dawn and dusk: the light rises (or falls) over 40 minutes around sunrise and sunset.
const TWILIGHT_MS = 40 * MINUTE;
// Default sun times, if the weather has not responded yet.
const DEFAULT_SUNRISE_HOUR = 7.5;
const DEFAULT_SUNSET_HOUR = 19;
// Wind from 0 to 1 based on km/h: beyond 40 km/h, everything bends to the maximum.
const WIND_MAX_KMH = 40;

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

export function seasonFor(date) {
  const month = date.getMonth();
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

function atHour(now, hour) {
  const date = new Date(now);
  date.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return date.getTime();
}

const clamp = (value) => Math.min(1, Math.max(0, value));
// Share of light that each weather type removes, for the dimness that turns on the lamps.
const WEATHER_GLOOM = { clear: 0, cloudy: 0.25, rain: 0.45, storm: 0.6, snow: 0.3, fog: 0.4 };

/**
 * Daylight from 0 (night) to 1 (full day), share of low-angle light (dawn, dusk), and the sun's course.
 */
export function daylight(now, weather) {
  const sunrise = weather?.sunrise ?? atHour(now, DEFAULT_SUNRISE_HOUR);
  const sunset = weather?.sunset ?? atHour(now, DEFAULT_SUNSET_HOUR);
  const day = clamp((now - sunrise + TWILIGHT_MS / 2) / TWILIGHT_MS) * clamp((sunset - now + TWILIGHT_MS / 2) / TWILIGHT_MS);
  const nearEdge = Math.min(Math.abs(now - sunrise), Math.abs(now - sunset));
  const golden = clamp(1 - nearEdge / (2 * TWILIGHT_MS));
  // 0 at sunrise, 1 at sunset: the sun moves from the east (right) to the west (left).
  const course = clamp((now - sunrise) / (sunset - sunrise));
  return { day, golden, course, night: day < 0.05 };
}

/**
 * Everything the scenery needs, optionally forced by the test page.
 */
export function conditionsFor(now, weather, override = {}) {
  const season = override.season ?? seasonFor(new Date(now));
  const light = override.hour != null ? daylight(atHour(now, override.hour), null) : daylight(now, weather);
  // The test page's "rainbow" is a clear sky right after rain.
  const rainbowTest = override.condition === 'rainbow';
  let condition = rainbowTest ? 'clear' : override.condition ?? weather?.condition ?? 'clear';
  const rainedRecently = rainbowTest || (!override.condition && Boolean(weather?.rainedRecently));
  // In winter, rain falls as snow.
  if (season === 'winter' && (condition === 'rain' || condition === 'storm')) condition = 'snow';
  const wind = override.condition ? (condition === 'storm' ? 1 : condition === 'clear' ? 0.25 : 0.5) : clamp((weather?.wind ?? 10) / WIND_MAX_KMH);
  // Dimness from 0 (full sun) to 1 (pitch night): at night, but also a low sun late in the day or an
  // overcast sky. It is what turns on the lamps, well before nightfall.
  const sunHeight = Math.sin(Math.PI * light.course);
  const gloom = clamp(1 - light.day * (1 - (WEATHER_GLOOM[condition] ?? 0)) * (0.45 + 0.55 * sunHeight));
  return { season, condition, wind, gloom, rainedRecently, ...light };
}
