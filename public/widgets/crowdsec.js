// Widget CrowdSec : attaques des dernières 24 h (pays, scénarios, fil des dernières) et adresses bannies.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

// Clé de bouncer (lecture seule) ou compte machine (alertes détaillées) : l'un ou l'autre.
WIDGET_TYPES.crowdsec = {
  label: 'CrowdSec', icon: 'crowdsec', kind: 'crowdsec', refresh: 30_000, port: 8080,
  fields: ['url', 'apiKey', 'username', 'password'], keyLabel: 'key.crowdsec', keyHelp: 'key.crowdsecHelp', keyOptional: true,
  userLabel: 'crowdsec.machine', userHelp: 'crowdsec.machineHelp', passwordLabel: 'crowdsec.password',
  alerts: 'crowdsec.alertHelp',
};

// « FR » -> drapeau (lettres régionales Unicode).
const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

RENDERERS.crowdsec = (d) => {
  const machine = d.mode === 'machine';
  const chips = (list, fmt = (x) => x.name) => h('div', { class: 'crowdsec-chips' }, list.map((x) => h('span', { class: 'badge' }, `${fmt(x)} · ${x.count}`)));
  return [
    h('div', { class: 'widget-stats' },
      machine ? h('div', { class: d.alerts24h ? 'stat-warn' : '' }, h('b', {}, String(d.alerts24h)), h('span', {}, t('crowdsec.alerts'))) : null,
      machine ? h('div', {}, h('b', {}, String(d.attackers24h)), h('span', {}, t('crowdsec.attackers'))) : null,
      h('div', {}, h('b', {}, String(d.bans.total)), h('span', {}, t('crowdsec.bans')))),
    machine && d.countries.length ? h('div', { class: 'widget-subhead' }, t('crowdsec.countries')) : null,
    machine && d.countries.length ? chips(d.countries, (x) => `${flag(x.name)} ${x.name}`) : null,
    (machine ? d.scenarios : d.bans.scenarios).length ? h('div', { class: 'widget-subhead' }, t('crowdsec.scenarios')) : null,
    (machine ? d.scenarios : d.bans.scenarios).length ? chips(machine ? d.scenarios : d.bans.scenarios) : null,
    h('div', { class: 'widget-subhead' }, t(machine ? 'crowdsec.recent' : 'crowdsec.recentBans')),
    d.recent.length
      ? h('ul', { class: 'widget-list' }, d.recent.map((a) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: a.as || a.ip }, `${flag(a.country)} ${a.ip}`.trim()),
          a.banned ? h('span', { class: 'badge bad' }, t('crowdsec.banned')) : h('span', { class: 'muted' }, a.time ? fmtAgo(a.time) : '')),
        h('div', { class: 'item-sub' }, [a.scenario, a.as, a.time && a.banned ? fmtAgo(a.time) : null, a.duration ? t('crowdsec.left', { duration: a.duration }) : null].filter(Boolean).join(' · ')))))
      : h('p', { class: 'muted' }, t('crowdsec.none')),
  ];
};
