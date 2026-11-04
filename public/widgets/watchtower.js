// Widget Watchtower : résultat de son dernier passage.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo…) : voir CONTRIBUTING.md.

WIDGET_TYPES.watchtower = {
  label: 'Watchtower', icon: 'watchtower', kind: 'watchtower', refresh: 60_000, port: 8080,
  fields: ['url', 'apiKey'], urlHelp: 'watchtower.urlHelp', keyLabel: 'watchtower.token', keyHelp: 'watchtower.tokenHelp',
};

RENDERERS.watchtower = (d) => [
  d.scans ? h('div', { class: 'widget-subhead' }, t('watchtower.lastScan')) : null,
  d.scans ? h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, String(d.scanned)), h('span', {}, t('watchtower.scanned'))),
    h('div', { class: d.updated ? 'stat-warn' : '' }, h('b', {}, String(d.updated)), h('span', {}, t('watchtower.updated'))),
    h('div', { class: d.failed ? 'stat-bad' : '' }, h('b', {}, String(d.failed)), h('span', {}, t('watchtower.failed')))) : null,
  h('p', { class: 'muted widget-note' }, d.scans ? t('watchtower.scans', { count: d.scans }) : t('watchtower.noScan')),
  d.seenAt ? h('p', { class: 'muted widget-note' }, t('watchtower.seen', { duration: fmtAgo(d.seenAt) })) : null,
];
