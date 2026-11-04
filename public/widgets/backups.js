// Widgets Sauvegardes : celles de Proxmox VE, et celles d'un script (disque USB…).
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, fmtBytes, meterEl…) : voir CONTRIBUTING.md.

WIDGET_TYPES.pvebackup = {
  label: t('pvebackup.label'), icon: 'proxmox', kind: 'pvebackup', refresh: 5 * 60_000,
  fields: ['url', 'username', 'apiKey'], userRequired: true, scheme: 'https', port: 8006,
  userLabel: 'key.proxmoxUser', userHelp: 'key.proxmoxUserHelp', keyLabel: 'key.proxmox', keyHelp: 'pvebackup.keyHelp',
  alerts: 'pvebackup.alertHelp', // case « M'alerter » : texte d'aide
};

RENDERERS.pvebackup = (d) => {
  const when = (iso) => t('backup.ago', { duration: fmtAgo(iso) });
  return [
    d.last ? h('p', { class: 'backup-status' },
      h('span', { class: `dot ${d.last.ok ? 'ok' : 'bad'}` }),
      ` ${t(d.last.ok ? 'backup.lastOk' : 'backup.lastFailed')} ${when(d.last.time)}`) : h('p', { class: 'muted' }, t('pvebackup.noTask')),
    d.last && !d.last.ok ? h('p', { class: 'error widget-note' }, d.last.status) : null,
    d.failed ? h('p', { class: 'muted widget-note' }, t('pvebackup.failed', { count: d.failed, total: d.tasks })) : null,
    d.guests.length ? h('ul', { class: 'widget-list' }, d.guests.map((g) => h('li', {},
      h('div', { class: 'row' }, h('span', { class: 'item-title' }, `${g.id}${g.name ? ` · ${g.name}` : ''}`), h('span', { class: 'muted' }, fmtBytes(g.size))),
      h('div', { class: 'item-sub' }, `${when(g.time)} · ${g.storage}`)))) : null,
    d.missing.length ? h('p', { class: 'muted widget-note' }, `⚠ ${t('pvebackup.missing', { names: d.missing.map((g) => g.name || g.id).join(', ') })}`) : null,
    ...d.storages.map((s) => meterEl(s.name, s.used / s.total, `${fmtBytes(s.used)} / ${fmtBytes(s.total)}`)),
    d.next ? h('p', { class: 'muted widget-note' }, t('pvebackup.next', { date: new Date(d.next * 1000).toLocaleString(LANG, { dateStyle: 'medium', timeStyle: 'short' }) })) : null,
  ];
};

WIDGET_TYPES.backup = {
  label: t('backup.label'), icon: '/icons/backup.svg', kind: 'backup', refresh: 60_000, fields: [], urlOptional: true,
  agentSetup: true, setupHelp: 'backup.setupHelp', setupCommands: backupCommands,
  waitingCode: 'backup_waiting', // rien reçu encore : message d'attente, pas d'erreur
  alerts: 'backup.alertHelp',
};

// À coller à la fin du script de sauvegarde. $? : le résultat de la commande juste au-dessus.
function backupCommands(base, s) {
  return [[t('backup.setupCommand'), [
    'STATUT=$?',
    'TAILLE=$(du -sb /mnt/usb/sauvegarde 2>/dev/null | cut -f1)',
    `curl -fsS -m 15 -X POST ${base}/api/agent/${s.id} -H "Authorization: Bearer ${s.token}" -H "Content-Type: application/json" \\`,
    '  -d "{\\"ok\\":$([ $STATUT -eq 0 ] && echo true || echo false),\\"size\\":${TAILLE:-0},\\"everyHours\\":24}"',
  ].join('\n')]];
}

RENDERERS.backup = (d) => [
  h('p', { class: 'backup-status' },
    h('span', { class: `dot ${d.ok && !d.late ? 'ok' : 'bad'}` }),
    ` ${t(d.ok ? 'backup.lastOk' : 'backup.lastFailed')} ${t('backup.ago', { duration: fmtAgo(d.time) })}`),
  d.late ? h('p', { class: 'error widget-note' }, `⚠ ${t('backup.late', { hours: d.everyHours })}`) : null,
  d.message ? h('p', { class: d.ok ? 'muted widget-note' : 'error widget-note' }, d.message) : null,
  d.size != null ? h('p', { class: 'muted widget-note' }, [t('backup.size', { size: fmtBytes(d.size) }), d.target].filter(Boolean).join(' · ')) : null,
  d.history.length > 1 ? h('div', { class: 'widget-subhead' }, t('backup.history')) : null,
  d.history.length > 1 ? h('ul', { class: 'widget-list' }, d.history.slice(1).map((x) => h('li', {},
    h('div', { class: 'row' },
      h('span', { class: 'item-title' }, h('span', { class: `dot ${x.ok ? 'ok' : 'bad'}` }), ` ${t('backup.ago', { duration: fmtAgo(x.time) })}`),
      h('span', { class: 'muted' }, x.size != null ? fmtBytes(x.size) : ''))))) : null,
];
