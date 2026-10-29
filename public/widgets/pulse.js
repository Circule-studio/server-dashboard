// Widget Pulse : santé, alertes, nœuds / VM / LXC (blocs au choix).
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.pulse = {
  label: 'Pulse', icon: 'pulse', kind: 'pulse', refresh: 15_000, port: 7655,
  keyLabel: 'key.pulse', keyHelp: 'key.pulseHelp',
  sections: ['health', 'alerts', 'resources'],
};

RENDERERS.pulse = (d) => {
  const VERDICTS = [['ok', 'ok'], ['attention', 'warn'], ['critical', 'bad'], ['stale', 'warn'], ['off', '']];
  const verdictDot = (v) => (VERDICTS.find(([k]) => k === v) || [, ''])[1];
  const levelDot = { critical: 'bad', warning: 'warn', info: '' };
  const reason = (code) => (I18N[LANG][`pulse.reason.${code}`] ? t(`pulse.reason.${code}`) : code.replace(/[-_]/g, ' '));
  const typeLabel = (type) => (I18N[LANG][`pulse.type.${type}`] ? t(`pulse.type.${type}`) : type);
  const blocks = [];
  const many = d.sections.length > 1;

  if (d.health) {
    const { verdicts, counts, attention } = d.health;
    if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.health')));
    blocks.push(h('div', { class: 'widget-stats pulse-verdicts' }, VERDICTS
      .filter(([k]) => k !== 'stale' || verdicts.stale)
      .map(([k, cls]) => h('div', { class: `verdict-${cls || 'off'}` },
        h('b', {}, String(verdicts[k] || 0)), h('span', {}, t(`pulse.verdict.${k}`))))));
    blocks.push(h('p', { class: 'pulse-counts muted' }, [
      tp('pulse.nodes', counts.nodes), t('pulse.vms', { count: counts.vms }), tp('pulse.containers', counts.containers),
      counts.docker ? tp('pulse.docker', counts.docker) : null,
    ].filter(Boolean).join(' · ')));
    if (attention.length) {
      blocks.push(h('ul', { class: 'widget-list' }, attention.map((a) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: typeLabel(a.type) }, h('span', { class: `dot ${verdictDot(a.verdict)}` }), ` ${a.name}`),
          h('span', { class: 'muted' }, reason(a.reason)))))));
    }
  }

  if (d.alerts) {
    if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.alerts', { count: d.alerts.length })));
    blocks.push(d.alerts.length
      ? h('ul', { class: 'widget-list' }, d.alerts.map((a) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: a.text },
            h('span', { class: `dot ${levelDot[a.level] ?? ''}` }), ` ${a.resource}`),
          h('span', { class: 'muted' }, a.acknowledged ? t('pulse.acknowledged') : t('pulse.since', { duration: fmtAgo(a.since) }))),
        h('div', { class: 'item-sub' }, a.text))))
      : h('p', { class: 'muted' }, t('pulse.noAlerts')));
  }

  if (d.resources) {
    if (many) blocks.push(h('div', { class: 'widget-subhead' }, t('pulse.resources')));
    const fmt = (v) => (v == null ? '–' : `${Math.round(v)} %`);
    blocks.push(d.resources.length
      ? h('ul', { class: 'widget-list' }, d.resources.map((r) => {
        const dot = r.verdict ? verdictDot(r.verdict) : r.status === 'online' ? 'ok' : r.status === 'warning' ? 'warn' : '';
        return h('li', {},
          h('div', { class: 'row' },
            h('span', { class: 'item-title', title: r.parent ? `${r.name} (${r.parent})` : r.name },
              h('span', { class: `dot ${dot}` }), ' ', h('span', { class: 'badge' }, typeLabel(r.type)), ` ${r.name}`),
            h('span', { class: 'muted' }, r.status === 'offline' ? t('pulse.stopped') : `${fmt(r.cpu)} CPU · ${fmt(r.mem)} RAM`)));
      }))
      : h('p', { class: 'muted' }, t('pulse.noResources')));
  }
  return blocks;
};
