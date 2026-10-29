// Widgets Pi-hole et AdGuard Home : requêtes DNS et protection.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.pihole = {
  label: 'Pi-hole', icon: 'pi-hole', kind: 'dns', refresh: 30_000, fields: ['url', 'password'],
  placeholder: 'http://192.168.1.10', passwordLabel: 'key.piholePassword', passwordHelp: 'key.piholePasswordHelp',
};

WIDGET_TYPES.adguard = {
  label: 'AdGuard Home', icon: 'adguard-home', kind: 'dns', refresh: 30_000, fields: ['url', 'username', 'password'],
  placeholder: 'http://192.168.1.10', passwordHelp: 'key.adguardHelp',
};

RENDERERS.dns = (d) => {
  const STATES = { enabled: 'ok', disabled: 'bad', failed: 'bad' };
  const protection = STATES[d.protection] ? d.protection : 'unknown';
  const extra = d.extra.filter((e) => e.value != null).map((e) => (e.key === 'avgTime'
    ? t('dns.avgTime', { ms: (e.value * 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) })
    : tp(`dns.${e.key}`, e.value, { n: e.value.toLocaleString(LOCALE) })));
  return [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, d.queries.toLocaleString(LOCALE)), h('span', {}, t('dns.queries'))),
      h('div', {}, h('b', {}, d.blocked.toLocaleString(LOCALE)), h('span', {}, t('dns.blocked'))),
      h('div', {}, h('b', {}, `${d.percent.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} %`), h('span', {}, t('dns.percent')))),
    h('p', { class: 'dns-status' },
      h('span', { class: `dot ${STATES[protection] || ''}` }), ' ', t(`dns.${protection}`),
      // Pause temporaire : la protection revient d'elle-même.
      protection === 'disabled' && d.timer ? h('span', { class: 'muted' }, ` · ${t('dns.timer', { duration: fmtEta(Math.round(d.timer)) })}`) : null),
    extra.length ? h('p', { class: 'muted dns-extra' }, extra.join(' · ')) : null,
  ];
};
