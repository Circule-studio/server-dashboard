// Widget API personnalisée : valeurs choisies d'une API JSON (chemin, libellé, format).
// Chargé après app.js, dont il utilise les outils (h, t, fmtBytes, fmtAgo…) : voir CONTRIBUTING.md.

WIDGET_TYPES.customapi = {
  label: t('customapi.label'), icon: '/icons/api.svg', kind: 'customapi', refresh: 30_000,
  fields: ['url', 'mappings', 'apiKey', 'username', 'password'], urlLabel: 'customapi.url', urlHelp: 'customapi.urlHelp',
  placeholder: 'http://192.168.1.10:8080/api/stats',
  keyLabel: 'customapi.header', keyHelp: 'customapi.headerHelp', keyOptional: true, passwordHelp: 'customapi.basicHelp',
};

// Valeur mise en forme ; « – » quand le chemin n'existe pas dans la réponse.
function customValue(v, format) {
  if (v == null || v === '') return '–';
  if (typeof v === 'boolean') return t(v ? 'customapi.yes' : 'customapi.no');
  const n = typeof v === 'number' ? v : Number(v);
  const num = (x) => x.toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  if (format === 'date') {
    const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v); // secondes ou millisecondes
    if (Number.isNaN(d.getTime())) return String(v);
    return d <= Date.now() ? t('customapi.ago', { duration: fmtAgo(d) })
      : d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  if (format === 'text' || !Number.isFinite(n)) return String(v);
  if (format === 'percent') return `${num(n)} %`;
  if (format === 'bytes') return fmtBytes(n);
  if (format === 'rate') return `${fmtBytes(n)}/s`;
  return num(n);
}

// Jusqu'à 4 valeurs : en blocs de chiffres ; au-delà, en liste « libellé … valeur ».
RENDERERS.customapi = (d) => (d.values.length <= 4
  ? h('div', { class: 'widget-stats' }, d.values.map((x) =>
    h('div', {}, h('b', { title: customValue(x.value, x.format) }, customValue(x.value, x.format)), h('span', {}, x.label))))
  : h('ul', { class: 'widget-list' }, d.values.map((x) => h('li', {},
    h('div', { class: 'row' }, h('span', { class: 'item-title', title: x.label }, x.label), h('span', { class: 'muted' }, customValue(x.value, x.format)))))));
