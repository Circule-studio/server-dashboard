// Faux Open-Meteo (prévisions + géocodage, même format que l'API publique).

const { http, json, day } = require('./lib');

const PLACES = [
  { id: 2990969, name: 'Nantes', latitude: 47.21725, longitude: -1.55336, country_code: 'FR', country: 'France', admin1: 'Pays de la Loire', timezone: 'Europe/Paris' },
  { id: 2988507, name: 'Paris', latitude: 48.85341, longitude: 2.3488, country_code: 'FR', country: 'France', admin1: 'Île-de-France', timezone: 'Europe/Paris' },
];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const bad = (reason) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: true, reason })); };
  if (u.pathname === '/v1/search') {
    const name = (u.searchParams.get('name') || '').split(',')[0].trim().toLowerCase();
    const found = name.length >= 2 ? PLACES.filter((p) => p.name.toLowerCase().startsWith(name)) : [];
    // Comme l'API réelle : sans résultat, la clé `results` est absente.
    return json(res, found.length ? { results: found.slice(0, Number(u.searchParams.get('count')) || 10), generationtime_ms: 0.4 } : { generationtime_ms: 0.3 });
  }
  if (u.pathname === '/v1/forecast') {
    const lat = Number(u.searchParams.get('latitude')), lon = Number(u.searchParams.get('longitude'));
    if (!u.searchParams.has('latitude') || Number.isNaN(lat)) return bad('Parameter \'latitude\' and \'longitude\' must have the same number of elements');
    const codes = [2, 61, 80, 3, 0];
    const now = new Date();
    return json(res, {
      latitude: lat, longitude: lon, generationtime_ms: 0.1, utc_offset_seconds: 3600, timezone: 'Europe/Paris', timezone_abbreviation: 'GMT+1', elevation: 20,
      current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', weather_code: 'wmo code', wind_speed_10m: 'km/h', is_day: '' },
      current: { time: now.toISOString().slice(0, 16), interval: 900, temperature_2m: 13.4, apparent_temperature: 11.2, weather_code: 2, wind_speed_10m: 17.6, is_day: 1 },
      daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
      daily: {
        time: codes.map((_, i) => day(i, 12).slice(0, 10)),
        weather_code: codes,
        temperature_2m_max: [15.1, 13.8, 12.2, 14.6, 16.9],
        temperature_2m_min: [8.3, 9.1, 7.4, 6.2, 5.8],
        precipitation_probability_max: [10, 85, 60, 25, 0],
      },
    });
  }
  res.writeHead(404); res.end();
}).listen(18765);
