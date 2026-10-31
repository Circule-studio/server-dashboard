// Widget Scrutiny : santé SMART des disques, ceux en échec en premier.
// Chargé après app.js, dont il utilise les outils (h, t, fmtBytes…) : voir CONTRIBUTING.md.

WIDGET_TYPES.scrutiny = {
  label: 'Scrutiny', icon: 'scrutiny', kind: 'scrutiny', refresh: 5 * 60_000, fields: ['url'], port: 8080,
  urlHelp: 'scrutiny.urlHelp', alerts: 'scrutiny.alertHelp', // case « M'alerter » : texte d'aide
};

RENDERERS.scrutiny = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, d.disks.length - d.failed), h('span', {}, t('scrutiny.healthy'))),
    h('div', { class: d.failed ? 'stat-bad' : '' }, h('b', {}, d.failed), h('span', {}, t('scrutiny.failed')))),
  d.disks.length
    ? h('ul', { class: 'widget-list' }, d.disks.map((x) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: x.model }, h('span', { class: `dot ${x.failed ? 'bad' : 'ok'}` }), ' ', x.name),
        h('span', { class: x.temp >= 55 ? 'scrutiny-hot' : 'muted' }, x.temp != null ? `${x.temp} °C` : '')),
      h('div', { class: 'item-sub' }, [
        x.model, x.capacity ? fmtBytes(x.capacity) : null,
        x.hours != null ? t('scrutiny.hours', { count: Math.round(x.hours).toLocaleString(LOCALE) }) : null,
        x.failed ? t(x.smartFailed ? 'scrutiny.smartFailed' : 'scrutiny.thresholdFailed') : null,
      ].filter(Boolean).join(' · ')))))
    : h('p', { class: 'muted' }, t('scrutiny.none')),
];
