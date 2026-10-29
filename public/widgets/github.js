// Widget GitHub : version, issues et pull requests d'un dépôt.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

// Sans URL, l'API publique de github.com ; le jeton est facultatif (dépôt public).
WIDGET_TYPES.github = {
  label: 'GitHub', icon: '/icons/github.svg', kind: 'github', refresh: 2 * 60_000,
  fields: ['repo', 'apiKey', 'url'], namePlaceholder: 'widget.namePlaceholderRepo', serverName: true,
  keyLabel: 'key.github', keyHelp: 'key.githubHelp', keyOptional: true,
  urlOptional: true, urlLabel: 'github.url', urlHelp: 'github.urlHelp', scheme: 'https', placeholder: 'https://api.github.com',
  sections: ['version', 'issues', 'pulls'],
  // Le titre mène à la page du dépôt : github.com, ou l'adresse de GitHub Enterprise sans /api/v3.
  href: (w) => {
    const web = !w.url || /^https:\/\/api\.github\.com\/?$/i.test(w.url) ? 'https://github.com' : w.url.replace(/\/api\/v3\/?$/, '');
    return w.repo ? `${web}/${w.repo}` : null;
  },
};

RENDERERS.github = (d) => {
  // En mode édition, un lien ne doit pas lancer le glisser natif du navigateur (comme le titre).
  const link = (url, text) => (url
    ? h('a', { href: url, target: '_blank', rel: 'noopener', draggable: state.editing ? 'false' : null }, text)
    : h('span', {}, text));
  const ago = (iso) => (iso ? t('common.ago', { duration: fmtAgo(iso) }) : '');
  const v = d.version;
  const blocks = [];
  // Limite de GitHub atteinte : les dernières données reçues restent affichées.
  if (d.limited) {
    blocks.push(h('p', { class: 'gh-limited' },
      `⏳ ${t('github.limited', { duration: fmtAgo(d.limited.since), minutes: d.limited.minutes })}`));
  }
  blocks.push(h('div', { class: 'widget-stats' },
    v ? h('div', { title: v.latest?.name || '' }, h('b', {}, v.latest?.tag || '–'), h('span', {}, t('github.version'))) : null,
    d.issues ? h('div', {}, h('b', {}, d.issues.total.toLocaleString(LOCALE)), h('span', {}, t('github.issues'))) : null,
    d.pulls ? h('div', {}, h('b', {}, d.pulls.total.toLocaleString(LOCALE)), h('span', {}, t('github.pulls'))) : null));
  blocks.push(h('p', { class: 'muted gh-meta' }, [
    d.repo.private ? t('github.private') : null,
    d.repo.archived ? t('github.archived') : null,
    `★ ${d.repo.stars.toLocaleString(LOCALE)}`,
    tp('github.forks', d.repo.forks, { n: d.repo.forks.toLocaleString(LOCALE) }),
    d.repo.pushed ? t('github.pushed', { duration: fmtAgo(d.repo.pushed) }) : null,
  ].filter(Boolean).join(' · ')));

  if (v) {
    blocks.push(h('div', { class: 'widget-subhead' }, t('github.versionHead')));
    const items = [];
    if (v.latest) {
      items.push(h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: v.latest.name }, '🏷 ', link(v.latest.url, v.latest.name),
            v.latest.prerelease ? h('span', { class: 'badge warn' }, t('github.prerelease')) : null),
          h('span', { class: 'muted' }, ago(v.latest.date))),
        h('div', { class: 'item-sub' }, v.unreleased == null ? ''
          : v.unreleased ? tp('github.unreleased', v.unreleased, { tag: v.latest.tag })
            : t('github.upToDate', { tag: v.latest.tag })),
        v.prerelease
          ? h('div', { class: 'item-sub' }, t('github.next', { tag: v.prerelease.tag, duration: fmtAgo(v.prerelease.date) }))
          : null,
        v.previous.length
          ? h('div', { class: 'item-sub' }, t('github.previous', { list: v.previous.map((r) => r.tag).join(' · ') }))
          : null));
    }
    if (v.commit) {
      items.push(h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: v.commit.message },
            h('code', { class: 'gh-sha' }, v.commit.sha), ' ', link(v.commit.url, v.commit.message)),
          h('span', { class: 'muted' }, ago(v.commit.date))),
        h('div', { class: 'item-sub' }, t('github.commitBy', { author: v.commit.author, branch: v.branch }))));
    }
    if (!v.latest && v.commit) items.unshift(h('li', { class: 'muted' }, t('github.noRelease')));
    blocks.push(items.length ? h('ul', { class: 'widget-list' }, items) : h('p', { class: 'muted' }, t('github.emptyRepo')));
  }

  // Issues et pull requests : même liste, avec un badge « brouillon » pour les PR.
  const list = (data, head, empty) => {
    blocks.push(h('div', { class: 'widget-subhead' }, t(head, { count: data.total.toLocaleString(LOCALE) })));
    blocks.push(data.items.length
      ? h('ul', { class: 'widget-list' }, data.items.map((i) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: i.title },
            i.draft ? h('span', { class: 'badge' }, t('github.draft')) : null, link(i.url, i.title)),
          h('span', { class: 'muted' }, ago(i.date))),
        h('div', { class: 'item-sub' },
          t('github.by', { number: i.number, author: i.author }),
          ...i.labels.map((l) => h('span', { class: 'gh-label' },
            h('i', { style: l.color ? `background:#${l.color}` : null }), l.name))))))
      : h('p', { class: 'muted' }, t(empty)));
  };
  if (d.issues) list(d.issues, 'github.issuesHead', 'github.noIssues');
  if (d.pulls) list(d.pulls, 'github.pullsHead', 'github.noPulls');
  return blocks;
};
