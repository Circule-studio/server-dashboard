// Widget Home Assistant : entités choisies.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

WIDGET_TYPES.homeassistant = {
  label: 'Home Assistant', icon: 'home-assistant', kind: 'ha', refresh: 15_000, fields: ['url', 'apiKey', 'entities'],
  port: 8123, keyLabel: 'key.ha', keyHelp: 'key.haHelp',
};

RENDERERS.ha = (d) => {
  // États on / off selon le type de capteur (device_class) : porte ouverte, mouvement détecté…
  const ON_OFF = {
    opening: [['door', 'window', 'opening', 'garage_door'], 'warn', ''],
    motion: [['motion', 'occupancy', 'presence'], 'warn', ''],
    alarm: [['moisture', 'smoke', 'gas', 'carbon_monoxide', 'problem', 'safety', 'tamper'], 'bad', 'ok'],
  };
  const show = (e) => {
    if (e.missing) return { text: t('ha.missing'), dot: 'bad' };
    if (e.state === 'unavailable' || e.state === 'unknown') return { text: t('ha.unavailable'), dot: 'bad' };
    if (e.state === 'on' || e.state === 'off') {
      const on = e.state === 'on';
      const [kind, [, onDot, offDot]] = Object.entries(ON_OFF).find(([, [classes]]) => classes.includes(e.deviceClass))
        || ['power', [, 'ok', '']];
      return { text: t(`ha.${kind}.${e.state}`), dot: on ? onDot : offDot };
    }
    const n = Number(e.state);
    if (e.state.trim() !== '' && Number.isFinite(n)) {
      return { text: `${n.toLocaleString(LOCALE, { maximumFractionDigits: 2 })}${e.unit ? ` ${e.unit}` : ''}` };
    }
    const known = I18N[LANG][`ha.state.${e.state}`];
    return { text: known ? t(`ha.state.${e.state}`) : `${e.state}${e.unit ? ` ${e.unit}` : ''}` };
  };
  return h('ul', { class: 'widget-list ha-list' }, d.entities.map((e) => {
    const s = show(e);
    return h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'item-title', title: e.id }, s.dot != null ? h('span', { class: `dot ${s.dot}` }) : null, ` ${e.name || e.id}`),
        h('b', { class: 'ha-value' }, s.text)),
      e.changed ? h('div', { class: 'item-sub' }, t('ha.since', { duration: fmtAgo(e.changed) })) : null);
  }));
};
