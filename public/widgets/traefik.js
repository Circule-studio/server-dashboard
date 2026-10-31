// Widget Traefik : routeurs, services et middlewares, ceux en erreur en premier, et entrypoints.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.traefik = {
  label: 'Traefik', icon: 'traefik', kind: 'traefik', refresh: 60_000, port: 8080,
  fields: ['url', 'username', 'password'], userLabel: 'traefik.user', passwordHelp: 'traefik.passwordHelp', urlHelp: 'traefik.urlHelp',
  alerts: 'traefik.alertHelp', // case « M'alerter » : texte d'aide
};

RENDERERS.traefik = (d) => {
  const stat = (c, label) => h('div', { class: c.errors ? 'stat-bad' : c.warnings ? 'stat-warn' : '' },
    h('b', {}, String(c.total)), h('span', {}, c.errors || c.warnings
      ? `${label} · ${[c.errors ? t('traefik.errors', { count: c.errors }) : null, c.warnings ? t('traefik.warnings', { count: c.warnings }) : null].filter(Boolean).join(', ')}`
      : label));
  return [
    h('div', { class: 'widget-stats' },
      stat(d.routers, t('traefik.routers')), stat(d.services, t('traefik.services')), stat(d.middlewares, t('traefik.middlewares'))),
    d.problems.length ? h('div', { class: 'widget-subhead' }, t('traefik.problems')) : null,
    d.problems.length ? h('ul', { class: 'widget-list' }, d.problems.map((p) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: p.rule || p.name }, h('span', { class: `dot ${p.status === 'error' ? 'bad' : 'warn'}` }), ` ${p.name}`),
        h('span', { class: `badge ${p.status === 'error' ? 'bad' : 'warn'}` }, t(p.status === 'error' ? 'traefik.error' : 'traefik.warning'))),
      p.error ? h('div', { class: 'item-sub', title: p.error }, p.error) : null))) : null,
    d.entrypoints.length ? h('p', { class: 'muted traefik-meta' },
      [d.version ? `Traefik ${d.version}` : null, d.entrypoints.map((e) => `${e.name} ${e.address}`).join(' · ')].filter(Boolean).join(' — ')) : null,
  ];
};
