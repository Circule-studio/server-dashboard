// Widget Alwaysdata : sites d'un compte d'hébergement, ceux qui ne répondent pas en premier.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

// Sans URL, l'API publique d'Alwaysdata.
WIDGET_TYPES.alwaysdata = {
  label: 'Alwaysdata', icon: '/icons/hosting.svg', kind: 'alwaysdata', refresh: 2 * 60_000,
  fields: ['apiKey', 'username', 'url'], keyLabel: 'key.alwaysdata', keyHelp: 'key.alwaysdataHelp',
  userLabel: 'alwaysdata.account', userHelp: 'alwaysdata.accountHelp',
  urlOptional: true, urlLabel: 'alwaysdata.url', urlHelp: 'alwaysdata.urlHelp', scheme: 'https', placeholder: 'https://api.alwaysdata.com/v1',
};

RENDERERS.alwaysdata = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, String(d.up)), h('span', {}, t('alwaysdata.up'))),
    h('div', { class: d.sites.length - d.up ? 'stat-bad' : '' }, h('b', {}, String(d.sites.length - d.up)), h('span', {}, t('alwaysdata.down'))),
    h('div', {}, h('b', {}, String(d.total)), h('span', {}, t('alwaysdata.total')))),
  d.sites.length
    ? h('ul', { class: 'widget-list' }, d.sites.map((s) => h('li', {},
      h('div', { class: 'row' },
        h('a', { class: 'item-title', href: `${s.scheme || 'https'}://${s.address}`, target: '_blank', rel: 'noopener', title: s.address },
          h('span', { class: `dot ${s.online ? 'ok' : 'bad'}` }), ` ${s.address}`),
        s.online
          ? h('span', { class: 'muted' }, `${s.ms} ms`)
          : h('span', { class: 'badge bad' }, s.code ? `HTTP ${s.code}` : t('alwaysdata.unreachable'))),
      s.note || s.type ? h('div', { class: 'item-sub' }, [s.note, s.type].filter(Boolean).join(' · ')) : null)))
    : h('p', { class: 'muted' }, t('alwaysdata.none')),
  d.total > d.sites.length ? h('p', { class: 'muted' }, t('alwaysdata.more', { count: d.total - d.sites.length })) : null,
];
