// Widgets Jellyfin et Plex : lectures en cours et taille de la bibliothèque.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.jellyfin = { label: 'Jellyfin', icon: 'jellyfin', kind: 'media', refresh: 10_000, keyHelp: 'key.jellyfinHelp', port: 8096 };

WIDGET_TYPES.plex = { label: 'Plex', icon: 'plex', kind: 'media', refresh: 10_000, keyLabel: 'key.plex', keyHelp: 'key.plexHelp', port: 32400 };

RENDERERS.media = (d) => [
  h('div', { class: 'widget-stats' }, d.stats.map((s) =>
    h('div', {}, h('b', {}, (s.value ?? 0).toLocaleString(LOCALE)), h('span', {}, t(`stat.${s.key}`))))),
  d.sessions.length
    ? h('ul', { class: 'widget-list' }, d.sessions.map((s) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: s.title }, `${s.paused ? '⏸' : '▶'} ${s.title}`),
        h('span', { class: 'muted' }, s.user || '')),
      h('div', { class: 'item-sub' }, [s.subtitle, s.device].filter(Boolean).join(' · ')),
      progressBar(s.progress, s.paused ? 'warn' : ''))))
    : h('p', { class: 'muted' }, t('media.nothing')),
];
