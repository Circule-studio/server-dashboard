// Widgets Sonarr et Radarr : à venir et file d'attente.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.sonarr = { label: 'Sonarr', icon: 'sonarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 8989 };

WIDGET_TYPES.radarr = { label: 'Radarr', icon: 'radarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 7878 };

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  // Les dates Radarr sont à minuit UTC : l'heure n'a pas de sens.
  const time = d.getUTCHours() || d.getUTCMinutes()
    ? ' ' + d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '';
  if (diff === 0) return `${t('day.today')}${time}`;
  if (diff === 1) return `${t('day.tomorrow')}${time}`;
  return d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }) + time;
}

RENDERERS.arr = (d) => [
  h('div', { class: 'widget-subhead' }, t('arr.upcoming')),
  d.upcoming.length
    ? h('ul', { class: 'widget-list' }, d.upcoming.map((e) => {
      const title = e.title || t('arr.unknownSeries');
      const sub = e.subtitle ?? [e.year, e.release && t(`arr.release.${e.release}`)].filter(Boolean).join(' · ');
      return h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title }, title),
          h('span', { class: e.hasFile ? 'badge ok' : 'muted' }, e.hasFile ? t('arr.available') : fmtDay(e.date))),
        h('div', { class: 'item-sub' }, sub));
    }))
    : h('p', { class: 'muted' }, t('arr.nothing')),
  h('div', { class: 'widget-subhead' }, t('arr.queue', { count: d.queue.total })),
  d.queue.items.length
    ? h('ul', { class: 'widget-list' }, d.queue.items.map((q) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: q.title }, q.title),
        h('span', { class: 'muted' }, pct(q.progress))),
      h('div', { class: 'item-sub' }, [q.status, q.timeleft && t('torrent.left', { eta: q.timeleft })].filter(Boolean).join(' · ')),
      progressBar(q.progress))))
    : h('p', { class: 'muted' }, t('arr.noDownloads')),
];
