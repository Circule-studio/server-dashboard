// Widget Uptime Kuma : sondes d'une page de statut, celles en panne en premier.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.uptimekuma = {
  label: 'Uptime Kuma', icon: 'uptime-kuma', kind: 'kuma', refresh: 30_000, fields: ['slug', 'url'],
  port: 3001, urlHelp: 'kuma.urlHelp',
  alerts: 'uptimekuma.alertHelp', // case « M'alerter » : texte d'aide
};

RENDERERS.kuma = (d) => {
  const DOTS = { up: 'ok', down: 'bad', pending: 'warn', maintenance: '', unknown: '' };
  const percent = (u) => `${(u * 100).toLocaleString(LOCALE, { maximumFractionDigits: u >= 0.999 ? 2 : 1 })} %`;
  return [
    h('div', { class: 'widget-stats' },
      h('div', {}, h('b', {}, String(d.up)), h('span', {}, t('kuma.up'))),
      h('div', { class: d.down ? 'stat-bad' : '' }, h('b', {}, String(d.down)), h('span', {}, t('kuma.down'))),
      d.uptime != null ? h('div', {}, h('b', {}, percent(d.uptime)), h('span', {}, t('kuma.uptime'))) : null),
    d.monitors.length
      ? h('ul', { class: 'widget-list' }, d.monitors.map((m) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: m.name }, h('span', { class: `dot ${DOTS[m.status]}` }), ` ${m.name}`),
          m.status === 'up' || m.status === 'unknown'
            ? h('span', { class: 'muted' }, [m.ping != null ? `${m.ping} ms` : null, m.uptime != null ? percent(m.uptime) : null]
              .filter(Boolean).join(' · ') || '–')
            : h('span', { class: `badge ${m.status === 'down' ? 'bad' : 'warn'}` }, t(`kuma.state.${m.status}`))),
        m.message ? h('div', { class: 'item-sub', title: m.message }, m.message) : null)))
      : h('p', { class: 'muted' }, t('kuma.none')),
    d.total > d.monitors.length ? h('p', { class: 'muted kuma-more' }, t('kuma.more', { count: d.total - d.monitors.length })) : null,
  ];
};
