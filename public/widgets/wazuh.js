// Widget Wazuh : agents (actifs, déconnectés), et alertes de sécurité des 24 h si l'indexer est renseigné.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.wazuh = {
  label: 'Wazuh', icon: 'wazuh', kind: 'wazuh', refresh: 60_000, port: 55000, scheme: 'https',
  fields: ['url', 'username', 'password', 'indexerUrl', 'apiKey'], userLabel: 'wazuh.user', userRequired: true,
  passwordHelp: 'wazuh.passwordHelp', urlHelp: 'wazuh.urlHelp',
  keyLabel: 'wazuh.indexerCreds', keyHelp: 'wazuh.indexerCredsHelp', keyOptional: true,
  alerts: 'wazuh.alertHelp', // case « M'alerter » : texte d'aide
};

RENDERERS.wazuh = (d) => {
  const a = d.agents;
  const level = (n) => (n >= 12 ? 'bad' : n >= 7 ? 'warn' : '');
  return [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, String(a.active)), h('span', {}, t('wazuh.active'))),
      h('div', { class: a.disconnected ? 'stat-bad' : '' }, h('b', {}, String(a.disconnected)), h('span', {}, t('wazuh.disconnected'))),
      a.never ? h('div', {}, h('b', {}, String(a.never)), h('span', {}, t('wazuh.never'))) : null),
    d.disconnected.length ? h('ul', { class: 'widget-list' }, d.disconnected.map((x) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title' }, h('span', { class: 'dot bad' }), ` ${x.name}`),
        h('span', { class: 'muted' }, x.lastKeepAlive ? fmtAgo(x.lastKeepAlive) : '–'))))) : null,
    d.alerts ? h('div', { class: 'widget-subhead' }, t('wazuh.alerts24h')) : null,
    d.alerts ? h('div', { class: 'widget-stats' },
      h('div', { class: d.alerts.high ? 'stat-bad' : '' }, h('b', {}, String(d.alerts.high)), h('span', {}, t('wazuh.high'))),
      h('div', { class: d.alerts.medium ? 'stat-warn' : '' }, h('b', {}, String(d.alerts.medium)), h('span', {}, t('wazuh.medium'))),
      h('div', {}, h('b', {}, String(d.alerts.low)), h('span', {}, t('wazuh.low')))) : null,
    d.alerts?.recent.length ? h('ul', { class: 'widget-list' }, d.alerts.recent.map((x) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: x.description }, h('span', { class: `dot ${level(x.level)}` }), ` ${x.description}`),
        h('span', { class: 'muted' }, x.time ? fmtAgo(x.time) : '')),
      h('div', { class: 'item-sub' }, [x.agent, t('wazuh.level', { level: x.level })].filter(Boolean).join(' · '))))) : null,
    d.alertsError ? h('p', { class: 'error' }, `⚠ ${t('wazuh.indexerError')} : ${errMsg({ code: d.alertsError })}`) : null,
    d.version ? h('p', { class: 'muted traefik-meta' }, `Wazuh ${d.version}`) : null,
  ];
};
