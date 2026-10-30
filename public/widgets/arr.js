// Widgets *arr : Sonarr, Radarr, Lidarr et Readarr (à venir et file d'attente), Prowlarr et Bazarr.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.sonarr = { label: 'Sonarr', icon: 'sonarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 8989 };

WIDGET_TYPES.radarr = { label: 'Radarr', icon: 'radarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 7878 };

WIDGET_TYPES.lidarr = { label: 'Lidarr', icon: 'lidarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 8686 };

WIDGET_TYPES.readarr = { label: 'Readarr', icon: 'readarr', kind: 'arr', refresh: 60_000, keyHelp: 'key.arrHelp', port: 8787 };

WIDGET_TYPES.prowlarr = { label: 'Prowlarr', icon: 'prowlarr', kind: 'prowlarr', refresh: 5 * 60_000, keyHelp: 'key.arrHelp', port: 9696 };

WIDGET_TYPES.bazarr = { label: 'Bazarr', icon: 'bazarr', kind: 'bazarr', refresh: 5 * 60_000, keyHelp: 'key.bazarrHelp', port: 6767 };

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

// « Demain 06:00 » au milieu d'une phrase : « jusqu'à demain 06:00 » (les dates restent telles quelles).
const midSentence = (s) => ([t('day.today'), t('day.tomorrow')].some((w) => s.startsWith(w)) ? s[0].toLocaleLowerCase(LOCALE) + s.slice(1) : s);

// Prowlarr : indexeurs actifs et en échec, requêtes et téléchargements récupérés.
RENDERERS.prowlarr = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, d.enabled), h('span', {}, t('prowlarr.enabled'))),
    h('div', { class: d.failing.length ? 'stat-bad' : '' }, h('b', {}, d.failing.length), h('span', {}, t('prowlarr.failing'))),
    h('div', {}, h('b', {}, d.queries.toLocaleString(LOCALE)), h('span', {}, t('prowlarr.queries'))),
    h('div', {}, h('b', {}, d.grabs.toLocaleString(LOCALE)), h('span', {}, t('prowlarr.grabs')))),
  d.failing.length
    ? h('ul', { class: 'widget-list' }, d.failing.map((f) => h('li', {},
      h('div', { class: 'row' }, h('span', { class: 'item-title', title: f.name }, h('span', { class: 'dot bad' }), ' ', f.name),
        h('span', { class: 'muted' }, t('prowlarr.until', { when: midSentence(fmtDay(f.until)) }))))))
    : null,
];

// Bazarr : ce qui manque encore de sous-titres.
RENDERERS.bazarr = (d) => [
  h('div', { class: 'widget-stats' },
    h('div', { class: d.episodes ? 'stat-warn' : '' }, h('b', {}, d.episodes.toLocaleString(LOCALE)), h('span', {}, t('bazarr.episodes'))),
    h('div', { class: d.movies ? 'stat-warn' : '' }, h('b', {}, d.movies.toLocaleString(LOCALE)), h('span', {}, t('bazarr.movies')))),
  d.providers ? h('p', { class: 'muted' }, tp('bazarr.providers', d.providers)) : null,
];
