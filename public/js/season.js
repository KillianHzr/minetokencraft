// Conditions du moment pour le décor : saison, heure du jour (soleil et lune), météo réelle.

const MINUTE = 60 * 1000;
// Aube et crépuscule : la lumière monte (ou baisse) sur 40 minutes autour du lever et du coucher.
const TWILIGHT_MS = 40 * MINUTE;
// Heures du soleil par défaut, si la météo n'a pas encore répondu.
const DEFAULT_SUNRISE_HOUR = 7.5;
const DEFAULT_SUNSET_HOUR = 19;
// Vent de 0 à 1 à partir des km/h : au-delà de 40 km/h, tout ploie au maximum.
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

/**
 * Lumière du jour de 0 (nuit) à 1 (plein jour), part de lumière rasante (aube, crépuscule), et course du soleil.
 */
export function daylight(now, weather) {
  const sunrise = weather?.sunrise ?? atHour(now, DEFAULT_SUNRISE_HOUR);
  const sunset = weather?.sunset ?? atHour(now, DEFAULT_SUNSET_HOUR);
  const day = clamp((now - sunrise + TWILIGHT_MS / 2) / TWILIGHT_MS) * clamp((sunset - now + TWILIGHT_MS / 2) / TWILIGHT_MS);
  const nearEdge = Math.min(Math.abs(now - sunrise), Math.abs(now - sunset));
  const golden = clamp(1 - nearEdge / (2 * TWILIGHT_MS));
  // 0 au lever, 1 au coucher : le soleil passe de l'est (à droite) à l'ouest (à gauche).
  const course = clamp((now - sunrise) / (sunset - sunrise));
  return { day, golden, course, night: day < 0.05 };
}

/**
 * Tout ce dont le décor a besoin, éventuellement forcé par la page de test.
 */
export function conditionsFor(now, weather, override = {}) {
  const season = override.season ?? seasonFor(new Date(now));
  const light = override.hour != null ? daylight(atHour(now, override.hour), null) : daylight(now, weather);
  let condition = override.condition ?? weather?.condition ?? 'clear';
  // L'hiver, la pluie tombe en neige.
  if (season === 'winter' && (condition === 'rain' || condition === 'storm')) condition = 'snow';
  const wind = override.condition ? (condition === 'storm' ? 1 : condition === 'clear' ? 0.25 : 0.5) : clamp((weather?.wind ?? 10) / WIND_MAX_KMH);
  return { season, condition, wind, ...light };
}
