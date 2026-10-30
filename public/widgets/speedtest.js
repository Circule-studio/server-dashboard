// Widget Speedtest Tracker : dernier test (descendant, montant, ping), moyenne et derniers tests.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo…) : voir CONTRIBUTING.md.

WIDGET_TYPES.speedtest = {
  label: 'Speedtest Tracker', icon: 'speedtest-tracker', kind: 'speedtest', refresh: 10 * 60_000, port: 8080,
  keyLabel: 'speedtest.token', keyHelp: 'speedtest.tokenHelp', keyOptional: true,
};

const num = (n) => n.toLocaleString(LOCALE, { maximumFractionDigits: n < 100 ? 1 : 0 });
const mbps = (n) => `${num(n)} Mbit/s`;

RENDERERS.speedtest = (d) => {
  const max = Math.max(1, ...d.history.map((r) => r.down));
  return [
    // L'unité dans le libellé : le chiffre tient même dans un widget étroit.
    h('div', { class: 'widget-stats' },
      h('div', { title: t('speedtest.down') }, h('b', {}, num(d.latest.down)), h('span', {}, '↓ Mbit/s')),
      h('div', { title: t('speedtest.up') }, h('b', {}, num(d.latest.up)), h('span', {}, '↑ Mbit/s')),
      h('div', {}, h('b', {}, d.latest.ping != null ? Math.round(d.latest.ping) : '–'), h('span', {}, t('speedtest.ping')))),
    d.latest.date ? h('p', { class: 'muted speedtest-when' }, t('speedtest.when', { duration: fmtAgo(d.latest.date) })) : null,
    d.average ? h('p', { class: 'muted' }, t('speedtest.average', { down: mbps(d.average.down), up: mbps(d.average.up), count: d.average.count })) : null,
    d.history.length > 1
      ? h('div', { class: 'speedtest-bars', 'aria-hidden': 'true' }, d.history.map((r) =>
        h('i', { style: `height: ${Math.max(4, Math.round((r.down / max) * 100))}%`, title: `${mbps(r.down)} · ${new Date(r.date).toLocaleString(LOCALE)}` })))
      : null,
  ];
};
