// Widget Calendrier : prochains événements (7 jours) d'un ou plusieurs agendas iCal, groupés par jour.
// Chargé après app.js, dont il utilise les outils (h, t, fmtAgo, progressBar…) : voir CONTRIBUTING.md.

// Les adresses iCal sont secrètes : elles passent par le champ de clé (jamais renvoyé au navigateur).
WIDGET_TYPES.ical = {
  label: 'Calendrier (iCal)', icon: '/icons/calendar.svg', kind: 'ical', refresh: 5 * 60_000,
  fields: ['apiKey', 'username', 'password'], keyLabel: 'key.ical', keyHelp: 'key.icalHelp',
  userLabel: 'ical.user', passwordLabel: 'ical.password', passwordHelp: 'ical.passwordHelp',
};

RENDERERS.ical = (d) => {
  const COLORS = ['var(--accent)', '#34d399', '#f59e0b', '#f472b6', '#a78bfa'];
  const dayKey = (e) => (e.allDay ? e.start : new Date(e.start).toLocaleDateString('sv'));
  const today = new Date().toLocaleDateString('sv');
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv');
  const dayLabel = (key) => (key === today ? t('ical.today') : key === tomorrow ? t('ical.tomorrow')
    : new Date(`${key}T12:00:00`).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }));
  const time = (iso) => new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  const groups = new Map();
  for (const e of d.events) {
    // Événement commencé avant aujourd'hui (journée entière, plusieurs jours) : rangé aujourd'hui.
    const key = dayKey(e) < today ? today : dayKey(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [
    d.events.length ? null : h('p', { class: 'muted' }, t('ical.none')),
    ...[...groups].flatMap(([key, events]) => [
      h('div', { class: 'widget-subhead' }, dayLabel(key)),
      h('ul', { class: 'widget-list ical-list' }, events.map((e) => h('li', {},
        h('div', { class: 'row' },
          h('span', { class: 'item-title', title: e.title },
            d.calendars > 1 ? h('span', { class: 'dot', style: `background:${COLORS[e.calendar % COLORS.length]}` }) : null,
            d.calendars > 1 ? ' ' : null, e.title),
          h('span', { class: 'muted' }, e.allDay ? t('ical.allDay') : `${time(e.start)} – ${time(e.end)}`)),
        e.location ? h('div', { class: 'item-sub', title: e.location }, e.location) : null))),
    ]),
    d.more ? h('p', { class: 'muted' }, t('ical.more', { count: d.more })) : null,
    d.failed ? h('p', { class: 'muted' }, t('ical.failed', { count: d.failed })) : null,
  ];
};
