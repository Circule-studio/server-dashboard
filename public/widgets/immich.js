// Widget Immich : photos, vidéos et stockage par utilisateur, plus les téléchargements
// quand un module dl-stats est placé devant Immich.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.immich = { label: 'Immich', icon: 'immich', kind: 'immich', refresh: 5 * 60_000, keyHelp: 'key.immichHelp', port: 2283 };

RENDERERS.immich = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, (d.photos ?? 0).toLocaleString(LOCALE)), h('span', {}, t('stat.photos'))),
    h('div', {}, h('b', {}, (d.videos ?? 0).toLocaleString(LOCALE)), h('span', {}, t('stat.videos'))),
    h('div', {}, h('b', {}, fmtBytes(d.usage)), h('span', {}, t('stat.usage')))),
  ...(d.downloads ? [
    h('div', { class: 'widget-subhead' }, t('immich.downloads')),
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, d.downloads.total.toLocaleString(LOCALE)), h('span', {}, t('stat.downloads'))),
      d.downloads.images != null ? h('div', {}, h('b', {}, d.downloads.images.toLocaleString(LOCALE)), h('span', {}, t('stat.downloadedPhotos'))) : null,
      d.downloads.visitors != null ? h('div', {}, h('b', {}, d.downloads.visitors.toLocaleString(LOCALE)), h('span', {}, t('stat.visitors'))) : null),
  ] : []),
  // Le détail par utilisateur n'a d'intérêt qu'à partir de deux comptes.
  ...(d.users.length > 1 ? [
    h('div', { class: 'widget-subhead' }, t('immich.users')),
    h('ul', { class: 'widget-list' }, d.users.map((u) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: u.name }, u.name),
        h('span', { class: 'muted' }, u.quota ? `${fmtBytes(u.usage)} / ${fmtBytes(u.quota)}` : fmtBytes(u.usage))),
      h('div', { class: 'item-sub' }, t('immich.userLine', { photos: u.photos.toLocaleString(LOCALE), videos: u.videos.toLocaleString(LOCALE) })),
      u.quota ? progressBar(u.usage / u.quota, u.usage / u.quota >= 0.9 ? 'bad' : u.usage / u.quota >= 0.7 ? 'warn' : '') : null))),
  ] : []),
];
