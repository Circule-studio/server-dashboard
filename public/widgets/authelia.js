// Widget Authelia : connexions, double authentification et accès, depuis son démarrage.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo…) : voir CONTRIBUTING.md.

WIDGET_TYPES.authelia = {
  label: 'Authelia', icon: 'authelia', kind: 'authelia', refresh: 30_000, port: 9959,
  fields: ['url'], urlHelp: 'authelia.urlHelp',
};

function autheliaAttempts(title, a) {
  return [
    h('div', { class: 'widget-subhead' }, title),
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, String(a.ok)), h('span', {}, t('authelia.ok'))),
      h('div', { class: a.failed ? 'stat-warn' : '' }, h('b', {}, String(a.failed)), h('span', {}, t('authelia.failed'))),
      h('div', { class: a.banned ? 'stat-bad' : '' }, h('b', {}, String(a.banned)), h('span', {}, t('authelia.banned')))),
  ];
}

RENDERERS.authelia = (d) => [
  ...autheliaAttempts(t('authelia.logins'), d.logins),
  ...autheliaAttempts(t('authelia.secondFactor'), d.secondFactor),
  h('p', { class: 'muted widget-note' }, t('authelia.access', { allowed: d.allowed, denied: d.denied })),
  d.since ? h('p', { class: 'muted widget-note' }, t('authelia.since', { duration: fmtAgo(d.since) })) : null,
];
