// Widget Mises à jour : badge « 7 mises à jour en attente », cliquable pour le détail par machine.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.updates = {
  label: t('updates.label'), icon: '/icons/updates.svg', kind: 'updates', refresh: 30_000, fields: [], urlOptional: true,
};

const STALE_LISTS_MS = 7 * 86400_000; // listes de paquets plus vieilles : le décompte n'est plus fiable
// Ce qui est déplié, gardé d'un rafraîchissement à l'autre (le contenu du widget est remplacé).
const updatesOpen = new Set();

function updatesDetails(key, open, summary, ...content) {
  return h('details', {
    class: 'updates-details', open: open || updatesOpen.has(key),
    ontoggle: (e) => { if (e.target.open) updatesOpen.add(key); else updatesOpen.delete(key); },
  }, h('summary', {}, summary), ...content);
}

const staleLists = (m) => m.packages?.listsAt && Date.now() - m.packages.listsAt > STALE_LISTS_MS;

// Ce qui ne va pas sur la machine, ou ce qui limite son décompte.
function updatesNotes(m) {
  return [
    m.offline ? t('agent.offline', { duration: fmtAgo(m.seen) }) : null,
    m.packages?.error ? t('updates.aptError') : null,
    m.docker?.error ? t('updates.dockerDenied') : null,
    staleLists(m) ? t('updates.staleLists', { duration: fmtAgo(m.packages.listsAt) }) : null,
    m.docker?.unknown ? t('updates.unknownImages', { count: m.docker.unknown }) : null,
  ].filter(Boolean).map((text) => h('p', { class: 'muted updates-note' }, `⚠ ${text}`));
}

function updatesMachine(m, w, hidden) {
  const packages = m.packages?.count || 0;
  const images = m.docker?.count || 0;
  const status = m.checking ? t('updates.checking') : m.waiting ? t('updates.waiting') : m.noData ? t('updates.oldAgent')
    : [packages ? t('updates.packages', { count: packages }) : null, images ? t('updates.images', { count: images }) : null].filter(Boolean).join(' · ') || t(staleLists(m) ? 'updates.staleShort' : 'updates.upToDate');
  const dot = m.offline || m.packages?.error || m.docker?.error ? 'bad' : packages + images ? 'warn' : m.checking || m.waiting || m.noData || staleLists(m) ? '' : 'ok';
  const row = h('span', { class: 'row updates-row' },
    h('span', { class: 'item-title' }, h('span', { class: `dot ${dot}` }), ` ${m.name}`),
    h('span', { class: 'muted' }, status));
  const notes = hidden ? [] : updatesNotes(m);
  const list = [
    (m.packages?.names || []).map((p) => h('li', {},
      h('span', { class: 'row' }, h('span', { class: 'item-title', title: p.name }, p.name),
        p.security ? h('span', { class: 'badge warn' }, t('updates.securityTag')) : null),
      h('div', { class: 'item-sub' }, p.version))),
    (m.docker?.images || []).map((x) => h('li', {},
      h('span', { class: 'item-title', title: x.image }, x.image),
      h('div', { class: 'item-sub' }, x.containers.join(', ')))),
  ].flat();
  const more = (m.packages?.count || 0) - (m.packages?.names?.length ?? m.packages?.count ?? 0);
  if (!list.length && !notes.length) return h('li', {}, row);
  return h('li', {}, updatesDetails(`${w.id}:${m.id}`, false, row,
    ...notes,
    list.length ? h('ul', { class: 'widget-list updates-packages' }, list) : null,
    more > 0 ? h('p', { class: 'muted updates-note' }, t('updates.more', { count: more })) : null));
}

RENDERERS.updates = (d, w) => {
  const key = d.total === 1 ? 'updates.pendingOne' : 'updates.pending';
  // « Tout est à jour » seulement si c'est sûr : une machine peut ne pas avoir répondu.
  const sure = !d.machines.some((m) => m.offline || m.checking || m.waiting || m.noData || m.packages?.error || m.docker?.error || staleLists(m));
  const badge = h('span', { class: `updates-badge ${d.total ? 'updates-pending' : sure ? 'updates-clean' : ''}` },
    h('b', {}, d.total ? t(key, { count: d.total }) : t(sure ? 'updates.none' : 'updates.noneKnown')),
    d.security ? h('small', {}, t('updates.security', { count: d.security })) : null);
  const machines = d.machines.length
    ? h('ul', { class: 'widget-list' }, d.machines.map((m) => updatesMachine(m, w, d.hidden)))
    : h('p', { class: 'muted' }, t('updates.noMachine'));
  return [
    updatesDetails(`${w.id}:all`, !d.machines.length, badge, machines,
      d.hidden ? h('p', { class: 'muted updates-note' }, t('updates.loginForDetails')) : null),
    !d.agents ? h('p', { class: 'muted updates-note' }, t('updates.addAgents')) : null,
  ];
};
