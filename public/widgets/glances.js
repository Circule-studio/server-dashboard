// Widget Glances : ressources d'une autre machine (PC, Raspberry Pi, NAS…), un widget par machine.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.glances = {
  label: 'Glances', icon: 'glances', kind: 'glances', refresh: 10_000, fields: ['url', 'username', 'password'],
  port: 61208, userHelp: 'key.glancesUser', passwordHelp: 'key.glancesHelp',
};

RENDERERS.glances = (d) => {
  const temp = d.temp && Math.round(d.temp.value);
  return [
    h('div', { class: 'row glances-head' },
      h('span', { class: 'item-title', title: d.os }, h('span', { class: 'dot ok' }), ` ${d.hostname || '–'}`),
      h('span', { class: 'muted' }, d.uptime != null ? t('glances.onlineFor', { duration: fmtUptime(d.uptime) }) : '')),
    d.cpu != null ? meterEl('CPU', d.cpu / 100, d.load?.cores
      ? t('glances.cpuLoad', { pct: `${Math.round(d.cpu)} %`, load: d.load.min1.toLocaleString(LOCALE, { maximumFractionDigits: 2 }) })
      : `${Math.round(d.cpu)} %`, d.cpuName) : null,
    d.mem ? meterEl('RAM', d.mem.used / d.mem.total, `${fmtBytes(d.mem.used)} / ${fmtBytes(d.mem.total)}`) : null,
    ...d.disks.map((disk) => meterEl(disk.mount, disk.used / disk.size, `${fmtBytes(disk.used)} / ${fmtBytes(disk.size)}`, disk.mount)),
    temp != null
      ? h('p', { class: `glances-temp temp-${temp >= 85 ? 'bad' : temp >= 70 ? 'warn' : 'ok'}`, title: d.temp.label },
        `🌡 ${temp} °C`, h('span', { class: 'muted' }, ` · ${d.temp.label}`))
      : null,
  ];
};
