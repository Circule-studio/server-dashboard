// Widget Proxmox Backup Server : datastores, tâches des dernières 24 h et ressources.
// Chargé après app.js, dont il utilise les outils (h, t, meterEl, fmtBytes…) : voir CONTRIBUTING.md.

WIDGET_TYPES.pbs = {
  label: 'Proxmox Backup Server', icon: 'proxmox', kind: 'pbs', refresh: 60_000,
  fields: ['url', 'username', 'apiKey'], userRequired: true, scheme: 'https', port: 8007,
  userLabel: 'key.proxmoxUser', userHelp: 'key.proxmoxUserHelp', keyLabel: 'key.proxmox', keyHelp: 'key.pbsHelp',
  alerts: 'pbs.alertHelp', // case « M'alerter » : texte d'aide
};

// Types de tâches traduits ; un autre type s'affiche tel quel.
const PBS_TASKS = ['backup', 'verify', 'garbage_collection', 'prune', 'syncjob'];
const pbsTask = (type) => (PBS_TASKS.includes(type) ? t(`pbs.task.${type}`) : type);

RENDERERS.pbs = (d) => [
  h('div', { class: 'widget-subhead' }, t('pbs.last24h')),
  h('div', { class: 'widget-stats' },
    h('div', {}, h('b', {}, d.backups.ok), h('span', {}, t('pbs.backupsOk'))),
    h('div', { class: d.backups.failed ? 'stat-bad' : '' }, h('b', {}, d.backups.failed), h('span', {}, t('pbs.backupsFailed'))),
    h('div', { class: d.failedCount ? 'stat-warn' : '' }, h('b', {}, d.tasks), h('span', {}, t('pbs.tasks')))),
  d.cpu != null ? meterEl('CPU', d.cpu, pct(d.cpu)) : null,
  d.mem ? meterEl('RAM', d.mem.used / d.mem.total, `${fmtBytes(d.mem.used)} / ${fmtBytes(d.mem.total)}`) : null,
  d.datastores.length ? h('div', { class: 'widget-subhead' }, t('pbs.datastores')) : null,
  ...d.datastores.map((s) => meterEl(s.name, s.used / s.total, `${fmtBytes(s.used)} / ${fmtBytes(s.total)}`)),
  d.failed.length ? h('div', { class: 'widget-subhead' }, tp('pbs.failed', d.failedCount)) : null,
  d.failed.length
    ? h('ul', { class: 'widget-list' }, d.failed.map((f) => h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: `${f.type} ${f.id}` }, h('span', { class: 'dot bad' }), ' ', pbsTask(f.type), f.id ? ` · ${f.id}` : ''),
        h('span', { class: 'muted' }, fmtAgo(f.time))),
      h('div', { class: 'item-sub', title: f.error }, f.error))))
    : null,
];
