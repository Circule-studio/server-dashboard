// Widget Météo (Open-Meteo).
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

// Sans URL, le serveur utilise le service public open-meteo.com.
WIDGET_TYPES.weather = {
  label: t('weather.label'), icon: '/icons/weather.svg', kind: 'weather', refresh: 10 * 60_000,
  fields: ['location', 'url'], nameFrom: 'location', urlOptional: true, urlLabel: 'weather.url', urlHelp: 'weather.urlHelp',
  scheme: 'https', placeholder: 'https://api.open-meteo.com', namePlaceholder: 'widget.namePlaceholderLocation',
};

// Codes météo WMO (doc Open-Meteo) -> icône ; le texte est dans weather.code.<code>.
const WEATHER_ICONS = [
  [[0], '☀️', '🌙'], [[1], '🌤️', '🌙'], [[2], '⛅', '☁️'], [[3], '☁️'], [[45, 48], '🌫️'],
  [[51, 53, 55, 56, 57, 80, 81, 82], '🌦️', '🌧️'], [[61, 63, 65, 66, 67], '🌧️'],
  [[71, 73, 75, 77, 85, 86], '🌨️'], [[95, 96, 97, 99], '⛈️'],
];
function weatherIcon(code, day = true) {
  const entry = WEATHER_ICONS.find(([codes]) => codes.includes(code));
  return entry ? (day ? entry[1] : entry[2] || entry[1]) : '🌡️';
}
const weatherText = (code) => (I18N[LANG][`weather.code.${code}`] ? t(`weather.code.${code}`) : '–');

function regionName(code) {
  try { return code ? new Intl.DisplayNames([LOCALE], { type: 'region' }).of(code) : ''; } catch { return code; }
}

RENDERERS.weather = (d) => {
  const c = d.current;
  const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);
  const place = d.place.name
    ? [d.place.name, regionName(d.place.country)].filter(Boolean).join(', ')
    : `${d.place.latitude}, ${d.place.longitude}`;
  const today = new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, comme l'API
  return [
    h('div', { class: 'weather-now' },
      h('span', { class: 'weather-icon', role: 'img', 'aria-label': weatherText(c.code) }, weatherIcon(c.code, c.day)),
      h('div', { class: 'weather-main' },
        h('b', { class: 'weather-temp' }, c.temp == null ? '–' : `${Math.round(c.temp)} ${d.units.temp}`),
        h('div', {}, weatherText(c.code)),
        h('div', { class: 'item-sub' }, [
          c.feels != null ? t('weather.feels', { temp: deg(c.feels) }) : null,
          c.wind != null ? t('weather.wind', { speed: `${Math.round(c.wind)} ${d.units.wind}` }) : null,
        ].filter(Boolean).join(' · ')),
        h('div', { class: 'item-sub', title: place }, `📍 ${place}`))),
    h('div', { class: 'weather-days' }, d.days.map((day) => h('div', { title: weatherText(day.code) },
      h('span', { class: 'weather-day' }, day.date === today
        ? t('weather.today')
        : new Date(`${day.date}T12:00`).toLocaleDateString(LOCALE, { weekday: 'short' })),
      h('span', { class: 'weather-icon-sm', role: 'img', 'aria-label': weatherText(day.code) }, weatherIcon(day.code)),
      h('b', {}, deg(day.max)),
      h('span', { class: 'muted' }, deg(day.min)),
      day.rain ? h('small', { class: 'weather-rain', title: t('weather.rainChance') }, `💧 ${day.rain} %`) : null))),
  ];
};
