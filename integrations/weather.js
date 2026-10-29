// Météo (Open-Meteo, sans clé API).
// `location` : un nom de ville, géocodé une seule fois, ou des coordonnées « 47.21, -1.55 ».
// `url` : facultative, pour une instance Open-Meteo auto-hébergée (ou les faux services).

const { fail, join, getJson } = require('./lib');

const OPEN_METEO = 'https://api.open-meteo.com';
const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com';
const places = new Map(); // `${url}|${location}` -> lieu géocodé

async function weatherPlace(w) {
  const location = (w.location || '').trim();
  if (!location) throw fail('location_missing', 'Lieu manquant');
  // Point ou virgule décimale (« 47.21, -1.55 » comme « 47,21 ; -1,55 »).
  const coords = location.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (coords) {
    const [latitude, longitude] = [coords[1], coords[2]].map((v) => Number(v.replace(',', '.')));
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw fail('location_not_found', `Lieu introuvable : ${location}`, { location });
    return { name: '', latitude, longitude };
  }
  const key = `${w.url}|${location}`;
  if (places.has(key)) return places.get(key);
  // Sans résultat, l'API omet le tableau `results` (et non un tableau vide).
  const search = `/v1/search?count=1&name=${encodeURIComponent(location)}`;
  let found;
  try {
    found = await getJson(join(w.url || OPEN_METEO_GEOCODING, search));
  } catch (e) {
    // Une instance Open-Meteo auto-hébergée ne fait que les prévisions : le géocodage est un
    // service à part (open-meteo/geocoding-api). Sans lui (404), on cherche sur le service public.
    if (!w.url || e.key !== 'http' || e.params?.status !== 404) throw e;
    found = await getJson(join(OPEN_METEO_GEOCODING, search));
  }
  const { results } = found;
  const p = results?.[0];
  if (!p) throw fail('location_not_found', `Lieu introuvable : ${location}`, { location });
  const place = { name: p.name, region: p.admin1 || '', country: p.country_code || '', latitude: p.latitude, longitude: p.longitude };
  places.set(key, place);
  return place;
}

async function weather(w) {
  const place = await weatherPlace(w);
  const q = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 5,
  });
  const d = await getJson(join(w.url || OPEN_METEO, `/v1/forecast?${q}`));
  const c = d.current || {};
  const daily = d.daily || {};
  return {
    place,
    units: { temp: d.current_units?.temperature_2m || '°C', wind: d.current_units?.wind_speed_10m || 'km/h' },
    current: {
      temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code,
      wind: c.wind_speed_10m, day: c.is_day !== 0,
    },
    // Dates locales du lieu (AAAA-MM-JJ), grâce à timezone=auto.
    days: (daily.time || []).map((date, i) => ({
      date,
      code: daily.weather_code?.[i],
      max: daily.temperature_2m_max?.[i],
      min: daily.temperature_2m_min?.[i],
      rain: daily.precipitation_probability_max?.[i] ?? null,
    })),
  };
}

module.exports = {
  weather: { fields: ['location', 'url'], cacheMs: 10 * 60_000, fetch: weather, reset: () => places.clear() },
};
