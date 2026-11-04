// Widget Loki : volume de logs et erreurs récentes des dernières 24 h.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, fmtBytes…) : voir CONTRIBUTING.md.

WIDGET_TYPES.loki = {
  label: 'Loki / Grafana', icon: 'loki', kind: 'loki', refresh: 60_000, port: 3100,
  fields: ['url', 'username', 'password', 'apiKey', 'query'], urlHelp: 'loki.urlHelp',
  userLabel: 'loki.user', passwordHelp: 'loki.passwordHelp',
  keyLabel: 'loki.token', keyHelp: 'loki.tokenHelp', keyOptional: true,
};

RENDERERS.loki = (d) => [
  h('div', { class: 'widget-subhead' }, t('loki.last24h')),
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, d.lines.toLocaleString(LANG)), h('span', {}, t('loki.lines'))),
    h('div', {}, h('b', {}, fmtBytes(d.bytes)), h('span', {}, t('loki.volume'))),
    h('div', { class: d.errors ? 'stat-bad' : '' }, h('b', {}, d.errors.toLocaleString(LANG)), h('span', {}, t('loki.errors')))),
  d.sources.length ? h('p', { class: 'muted widget-note' }, d.sources.map((s) => `${s.name} (${s.count.toLocaleString(LANG)})`).join(' · ')) : null,
  d.recent.length ? h('div', { class: 'widget-subhead' }, t('loki.recent')) : null,
  d.recent.length ? h('ul', { class: 'widget-list' }, d.recent.map((x) => h('li', {},
    h('div', { class: 'item-title loki-line', title: x.line }, x.line),
    h('div', { class: 'item-sub' }, [x.source, fmtAgo(x.time)].filter(Boolean).join(' · '))))) : null,
  d.hidden ? h('p', { class: 'muted widget-note' }, t('loki.login')) : null,
  !d.lines ? h('p', { class: 'muted widget-note' }, t('loki.empty')) : null,
];
