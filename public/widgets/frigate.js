// Widget Frigate : caméras et derniers événements.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.frigate = {
  label: 'Frigate', icon: 'frigate', kind: 'frigate', refresh: 10_000, fields: ['url', 'username', 'password'],
  port: 5000, passwordHelp: 'key.frigateHelp',
};

// Les miniatures passent par le dashboard (/api/widgets/:id/thumbnail/:événement).
RENDERERS.frigate = (d, w) => {
  const label = (l) => (I18N[LANG][`frigate.label.${l}`] ? t(`frigate.label.${l}`) : l);
  const online = d.cameras.filter((c) => c.online).length;
  const fps = (v) => v.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  return [
    h('div', { class: 'widget-stats' },
      h('div', { class: online < d.cameras.length ? 'stat-warn' : '' },
        h('b', {}, `${online} / ${d.cameras.length}`), h('span', {}, t('frigate.online'))),
      d.inference != null
        ? h('div', {}, h('b', {}, `${fps(d.inference)} ms`), h('span', {}, t('frigate.inference'))) : null),
    h('ul', { class: 'widget-list frigate-cams' }, d.cameras.map((c) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title' }, h('span', { class: `dot ${c.online ? 'ok' : 'bad'}` }), ` ${c.name}`),
        h('span', { class: 'muted' }, c.online
          ? t('frigate.fps', { fps: fps(c.fps), detect: fps(c.detectionFps) }) : t('frigate.offline')))))),
    h('div', { class: 'widget-subhead' }, t('frigate.events')),
    d.events.length
      ? h('div', { class: 'frigate-events' }, d.events.map((e) => h('figure', { title: e.score != null ? `${Math.round(e.score * 100)} %` : null },
        h('img', {
          // En cours : adresse changée à chaque rafraîchissement, la miniature peut encore s'améliorer.
          src: `/api/widgets/${encodeURIComponent(w.id)}/thumbnail/${encodeURIComponent(e.id)}${e.ongoing ? `?live=${Date.now()}` : ''}`,
          alt: label(e.label), loading: 'lazy',
          onerror: (ev) => ev.target.replaceWith(h('div', { class: 'frigate-noimg', 'aria-hidden': 'true' }, '📷')),
        }),
        h('figcaption', {},
          h('b', {}, label(e.label)), e.ongoing ? h('span', { class: 'badge warn' }, t('frigate.ongoing')) : null,
          h('span', { class: 'muted' }, [e.camera, e.start ? t('common.ago', { duration: fmtAgo(e.start) }) : null].filter(Boolean).join(' · '))))))
      : h('p', { class: 'muted' }, t('frigate.noEvents')),
  ];
};
