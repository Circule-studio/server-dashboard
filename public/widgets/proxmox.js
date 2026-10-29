// Widget Proxmox VE : hôtes, VM et conteneurs LXC, stockages.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.proxmox = {
  label: 'Proxmox VE', icon: 'proxmox', kind: 'proxmox', refresh: 10_000, fields: ['url', 'username', 'apiKey'],
  scheme: 'https', port: 8006,
  userLabel: 'key.proxmoxUser', userHelp: 'key.proxmoxUserHelp', userRequired: true,
  keyLabel: 'key.proxmox', keyHelp: 'key.proxmoxHelp',
};

RENDERERS.proxmox = (d) => {
  const level = (r) => (r >= 0.9 ? 'bad' : r >= 0.7 ? 'warn' : 'ok');
  const meter = (label, ratio, detail) => h('div', { class: 'meter' },
    h('span', { class: 'meter-label' }, label),
    progressBar(ratio, level(ratio)),
    h('span', { class: 'meter-value' }, detail));
  const multiNode = d.nodes.length > 1;
  return [
    ...d.nodes.map((n) => h('div', { class: 'pve-node' },
      h('div', { class: 'row' },
        h('span', { class: 'item-title' }, h('span', { class: `dot ${n.online ? 'ok' : 'bad'}` }), ` ${n.name}`),
        h('span', { class: 'muted' }, n.online ? t('pve.onlineFor', { duration: fmtUptime(n.uptime) }) : t('pve.offline'))),
      n.online ? [
        meter('CPU', n.cpu, `${pct(n.cpu)} · ${t('pve.cores', { count: n.cores })}`),
        meter('RAM', n.mem / n.maxmem, `${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`),
        meter(t('pve.disk'), n.disk / n.maxdisk, `${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`),
      ] : null)),
    h('div', { class: 'widget-subhead' }, t('pve.guests', { running: d.running, total: d.guests.length })),
    d.guests.length
      ? h('ul', { class: 'widget-list' }, d.guests.map((g) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: `${g.type} ${g.id} · ${g.name}` },
            h('span', { class: `dot ${g.running ? 'ok' : ''}` }), ' ',
            h('span', { class: 'badge' }, g.type), ` ${g.id} · ${g.name}`),
          h('span', { class: 'muted' }, g.running ? `${pct(g.cpu)} CPU · ${pct(g.mem)} RAM` : t('pve.stopped'))),
        multiNode ? h('div', { class: 'item-sub' }, g.node) : null)))
      : h('p', { class: 'muted' }, t('pve.noGuests')),
    d.storages.length ? h('div', { class: 'widget-subhead' }, t('pve.storages')) : null,
    ...d.storages.map((s) => meter(multiNode ? `${s.name} (${s.node})` : s.name, s.used / s.total,
      `${fmtBytes(s.used)} / ${fmtBytes(s.total)}`)),
  ];
};
