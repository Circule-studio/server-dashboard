// Widget Flux RSS / Atom : derniers articles d'un ou plusieurs flux, du plus récent au plus ancien.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.rss = {
  label: 'RSS / Atom', icon: '/icons/rss.svg', kind: 'rss', refresh: 15 * 60_000, fields: ['feeds'],
};

// Titres en texte (h() n'interprète pas le HTML) ; le serveur ne garde que les liens http(s).
RENDERERS.rss = (d) => [
  d.items.length
    ? h('ul', { class: 'widget-list' }, d.items.map((it) => h('li', {},
      it.link
        ? h('a', { class: 'item-title rss-title', href: it.link, target: '_blank', rel: 'noopener noreferrer', title: it.title }, it.title)
        : h('span', { class: 'item-title rss-title', title: it.title }, it.title),
      h('div', { class: 'item-sub' }, [it.source, it.date ? fmtAgo(it.date) : null].filter(Boolean).join(' · ')))))
    : h('p', { class: 'muted' }, t('rss.none')),
  d.failed ? h('p', { class: 'muted rss-failed' }, t('rss.failed', { count: d.failed })) : null,
];
