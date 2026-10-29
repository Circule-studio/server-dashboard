// Widget GoAccess : visiteurs uniques, requêtes et visiteurs des derniers jours d'un site.
// Chargé après app.js, dont il utilise les outils (h, t, fmtBytes, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.goaccess = {
  label: 'GoAccess', icon: 'goaccess', kind: 'goaccess', refresh: 5 * 60_000, fields: ['url'], urlHelp: 'goaccess.urlHelp',
};

RENDERERS.goaccess = (d) => {
  const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  const today = new Date().toLocaleDateString('sv'); // AAAA-MM-JJ, heure locale
  const max = Math.max(1, ...d.days.map((x) => x.visitors));
  return [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, d.visitors.toLocaleString(LOCALE)), h('span', {}, t('goaccess.visitors'))),
      d.days[0]?.date === today ? h('div', {}, h('b', {}, d.days[0].visitors.toLocaleString(LOCALE)), h('span', {}, t('goaccess.today'))) : null,
      d.requests != null ? h('div', {}, h('b', {}, d.requests.toLocaleString(LOCALE)), h('span', {}, t('goaccess.requests'))) : null,
      d.bandwidth != null ? h('div', {}, h('b', {}, fmtBytes(d.bandwidth)), h('span', {}, t('goaccess.bandwidth'))) : null),
    d.from ? h('p', { class: 'muted goaccess-period' }, t('goaccess.period', { from: day(d.from), to: day(d.to) })) : null,
    d.days.length ? h('div', { class: 'widget-subhead' }, t('goaccess.perDay')) : null,
    d.days.length ? h('ul', { class: 'widget-list' }, d.days.map((x) => h('li', {},
      h('div', { class: 'row' }, h('span', {}, day(x.date)), h('span', { class: 'muted' }, t('goaccess.dayLine', { visitors: x.visitors.toLocaleString(LOCALE) }))),
      progressBar(x.visitors / max)))) : null,
  ];
};
