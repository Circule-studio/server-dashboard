// Widget Nginx Proxy Manager : hôtes et certificats SSL.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.npm = {
  label: 'Nginx Proxy Manager', icon: 'nginx-proxy-manager', kind: 'npm', refresh: 5 * 60_000,
  fields: ['url', 'username', 'password'], port: 81, userLabel: 'key.npmUser', userRequired: true, passwordHelp: 'key.npmHelp',
};

RENDERERS.npm = (d) => {
  // Expiré : rouge ; dans les 14 jours (soonDays) : orange.
  const soon = (c) => c.expired || (c.days != null && c.days <= d.soonDays);
  const level = (c) => (c.days == null ? '' : c.expired ? 'bad' : soon(c) ? 'warn' : 'ok');
  const when = (c) => (c.days == null ? '–'
    : c.expired ? t('npm.expired')
      : soon(c) ? tp('npm.inDays', c.days)
        : new Date(c.expires).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }));
  return [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, String(d.hosts.enabled)), h('span', {}, t('npm.enabled'))),
      h('div', {}, h('b', {}, String(d.hosts.disabled)), h('span', {}, t('npm.disabled'))),
      h('div', { class: d.expiring ? 'stat-warn' : '' }, h('b', {}, String(d.expiring)), h('span', {}, t('npm.expiring')))),
    h('div', { class: 'widget-subhead' }, t('npm.certificates', { count: d.certificateCount })),
    d.certificates.length
      ? h('ul', { class: 'widget-list' }, d.certificates.map((c) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: c.name }, h('span', { class: `dot ${level(c)}` }), ` ${c.name}`),
          h('span', { class: soon(c) ? `badge ${level(c)}` : 'muted' }, when(c))),
        h('div', { class: 'item-sub' }, [
          c.provider === 'letsencrypt' ? "Let's Encrypt" : t('npm.custom'),
          c.domains > 1 ? tp('npm.domains', c.domains) : null,
        ].filter(Boolean).join(' · ')))))
      : h('p', { class: 'muted' }, t('npm.noCertificates')),
  ];
};
