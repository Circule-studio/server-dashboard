// Widget qBittorrent : débits et torrents.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.qbittorrent = { label: 'qBittorrent', icon: 'qbittorrent', kind: 'torrent', refresh: 5_000, fields: ['url', 'username', 'password'], port: 8080 };

const fmtSpeed = (b) => `${fmtBytes(b)}/s`;

RENDERERS.torrent = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, fmtSpeed(d.download)), h('span', {}, t('torrent.down'))),
    h('div', {}, h('b', {}, fmtSpeed(d.upload)), h('span', {}, t('torrent.up'))),
    h('div', {}, h('b', {}, `${d.counts.downloading} / ${d.counts.seeding}`), h('span', {}, t('torrent.dlSeed')))),
  d.torrents.length
    ? h('ul', { class: 'widget-list' }, d.torrents.map((tor) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: tor.name }, tor.name),
        h('span', { class: 'muted' }, pct(tor.progress))),
      h('div', { class: 'item-sub' }, tor.group === 'downloading'
        ? `↓ ${fmtSpeed(tor.dlspeed)} · ${t('torrent.left', { eta: fmtEta(tor.eta) })}`
        : tor.group === 'seeding' ? `↑ ${fmtSpeed(tor.upspeed)} · ${fmtBytes(tor.size)}`
          : tor.group === 'error' ? t('torrent.error') : `${t('torrent.paused')} · ${fmtBytes(tor.size)}`),
      progressBar(tor.progress, tor.group === 'error' ? 'bad' : tor.group === 'paused' ? 'warn' : ''))))
    : h('p', { class: 'muted' }, t('torrent.none')),
];
