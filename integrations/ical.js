// Calendrier : prochains événements d'un ou plusieurs agendas iCal (.ics) — Nextcloud, Google Agenda
// (adresse secrète iCal), Proton, Radicale, Baïkal… Les adresses sont secrètes (elles donnent accès à
// l'agenda) : elles passent par `apiKey` (une ou plusieurs, séparées par des espaces) et ne quittent
// jamais le serveur. Identifiant et mot de passe facultatifs (HTTP Basic, ex. Nextcloud).
// Lecture sans dépendance : lignes repliées, dates (UTC, TZID, flottantes, journées entières),
// récurrences RRULE (DAILY, WEEKLY, MONTHLY, YEARLY avec INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY),
// exceptions EXDATE et occurrences modifiées (RECURRENCE-ID).

const { request, fail, basicAuth } = require('./lib');

const DAYS_AHEAD = 7;
const MAX_EVENTS = 10;
const MAX_CALENDARS = 5;
const MAX_STEPS = 5000; // garde-fou pour une règle qui ne finit jamais
const DAY = 864e5;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Lignes « nom;param=…:valeur », lignes repliées (CRLF suivi d'un espace ou d'une tabulation) réunies.
function lines(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean).map((l) => {
    const colon = l.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const [name, ...params] = l.slice(0, colon).split(';');
    return {
      name: name.toUpperCase(),
      params: Object.fromEntries(params.map((p) => { const [k, v = ''] = p.split('='); return [k.toUpperCase(), v.replace(/^"|"$/g, '')]; })),
      value: l.slice(colon + 1),
    };
  });
}

const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// Décalage d'un fuseau à un instant donné (ms), via Intl. Fuseau inconnu (nom Windows…) : null.
function tzOffset(t, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  } catch {
    return null;
  }
}

// Heure murale (exprimée comme un instant UTC) dans le fuseau `zone` -> instant réel.
function toInstant(wall, zone) {
  if (zone === 'UTC' || zone === 'DATE') return wall;
  if (zone !== 'LOCAL') {
    const first = tzOffset(wall, zone);
    if (first != null) {
      const guess = wall - first;
      return wall - tzOffset(guess, zone);
    }
  }
  // Heure flottante ou fuseau inconnu : heure du serveur.
  const d = new Date(wall);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
}

// Valeur DTSTART / DTEND / EXDATE -> { wall, zone } ; wall : heure murale codée en ms UTC.
function parseDate(prop) {
  const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const zone = !m[4] || prop.params.VALUE === 'DATE' ? 'DATE' : m[7] ? 'UTC' : prop.params.TZID || 'LOCAL';
  return { wall, zone };
}

const DURATION = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
function parseDuration(v) {
  const m = v.trim().match(DURATION);
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * 3600e3) + ((+m[5] || 0) * 60e3) + ((+m[6] || 0) * 1e3);
  return m[1] === '-' ? -ms : ms;
}

function parseRule(v) {
  const r = Object.fromEntries(v.split(';').map((p) => p.split('=')).map(([k, x]) => [k.toUpperCase(), x]));
  return {
    freq: r.FREQ, interval: Math.max(1, Number(r.INTERVAL) || 1), count: r.COUNT ? Number(r.COUNT) : null,
    until: r.UNTIL ? parseDate({ value: r.UNTIL, params: {} }) : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map((d) => { const m = d.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/); return m && { n: m[1] ? Number(m[1]) : 0, day: WEEKDAYS.indexOf(m[2]) }; }).filter(Boolean) : [],
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number).filter(Boolean) : [],
  };
}

// Jours d'un mois qui correspondent à BYDAY (« 2MO », « -1FR », « MO ») ou BYMONTHDAY, triés.
function monthDays(y, m, rule, startDay) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let days;
  if (rule.bymonthday.length) days = rule.bymonthday.map((d) => (d > 0 ? d : last + d + 1));
  else if (rule.byday.length) {
    days = rule.byday.flatMap(({ n, day }) => {
      const all = [];
      for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === day) all.push(d);
      return n === 0 ? all : [n > 0 ? all[n - 1] : all[all.length + n]];
    });
  } else days = [startDay];
  return [...new Set(days)].filter((d) => d >= 1 && d <= last).sort((a, b) => a - b);
}

// Heures murales des occurrences, de DTSTART jusqu'à `end` (heure murale), dans l'ordre. Sans COUNT,
// les périodes antérieures à `from` sont sautées (un rendez-vous quotidien qui dure depuis des années).
function* occurrences(start, rule, from, end) {
  const s = new Date(start);
  const time = start % DAY;
  const day0 = start - time;
  const until = rule.until ? rule.until.wall : Infinity;
  let emitted = 0;
  const period = { DAILY: DAY, WEEKLY: 7 * DAY }[rule.freq] * rule.interval;
  const skip = !rule.count && period ? Math.max(0, Math.floor((from - start) / period) - 1) : 0;
  const emit = function* (wall) {
    if (wall < start || wall > until) return;
    emitted++;
    yield wall;
  };
  for (let i = skip; i < skip + MAX_STEPS; i++) {
    let candidates;
    if (rule.freq === 'DAILY') candidates = [day0 + i * rule.interval * DAY];
    else if (rule.freq === 'WEEKLY') {
      // Semaine commençant le lundi (WKST=MO par défaut).
      const monday = day0 - ((s.getUTCDay() + 6) % 7) * DAY + i * rule.interval * 7 * DAY;
      const days = rule.byday.length ? rule.byday.map((b) => b.day) : [s.getUTCDay()];
      candidates = [...new Set(days)].map((d) => monday + ((d + 6) % 7) * DAY).sort((a, b) => a - b);
    } else if (rule.freq === 'MONTHLY') {
      const y = s.getUTCFullYear(), m = s.getUTCMonth() + i * rule.interval;
      candidates = monthDays(y, m, rule, s.getUTCDate()).map((d) => Date.UTC(y, m, d));
    } else if (rule.freq === 'YEARLY') {
      const y = s.getUTCFullYear() + i * rule.interval;
      const d = Date.UTC(y, s.getUTCMonth(), s.getUTCDate());
      candidates = new Date(d).getUTCMonth() === s.getUTCMonth() ? [d] : []; // 29 février
    } else return;
    for (const c of candidates) {
      const wall = c + time;
      if (wall > end || wall > until || (rule.count && emitted >= rule.count)) return;
      yield* emit(wall);
    }
  }
}

// Événements d'un agenda qui touchent la fenêtre [from, to] (instants), pour l'agenda n° `calendar`.
function parseCalendar(text, from, to, calendar) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw fail('ical_invalid', 'Ce n\'est pas un agenda iCal (.ics)');
  const props = lines(text);
  const events = [];
  let cur = null;
  for (const p of props) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') cur = { exdates: [] };
    else if (p.name === 'END' && p.value.toUpperCase() === 'VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      if (p.name === 'EXDATE') cur.exdates.push(...p.value.split(',').map((v) => parseDate({ value: v, params: p.params })).filter(Boolean));
      else cur[p.name] = p;
    }
  }
  // Occurrences modifiées : elles remplacent l'occurrence d'origine de l'événement récurrent.
  const replaced = new Set();
  for (const e of events) {
    if (!e['RECURRENCE-ID'] || !e.UID) continue;
    const r = parseDate(e['RECURRENCE-ID']);
    if (r) replaced.add(`${e.UID.value}|${toInstant(r.wall, r.zone)}`);
  }
  const out = [];
  for (const e of events) {
    if (!e.DTSTART || e.STATUS?.value.toUpperCase() === 'CANCELLED') continue;
    const start = parseDate(e.DTSTART);
    if (!start) continue;
    const allDay = start.zone === 'DATE';
    const endDate = e.DTEND && parseDate(e.DTEND);
    const length = endDate ? endDate.wall - start.wall : e.DURATION ? parseDuration(e.DURATION.value) ?? 0 : allDay ? DAY : 0;
    const excluded = new Set(e.exdates.map((x) => toInstant(x.wall, x.zone)));
    // Fenêtre en heure murale, élargie d'un jour de chaque côté pour les décalages de fuseau.
    const walls = e.RRULE && !e['RECURRENCE-ID']
      ? occurrences(start.wall, parseRule(e.RRULE.value), from - DAY - Math.max(0, length), to + DAY)
      : [start.wall];
    for (const wall of walls) {
      const t0 = toInstant(wall, start.zone);
      if (excluded.has(t0) || (e['RECURRENCE-ID'] == null && e.UID && replaced.has(`${e.UID.value}|${t0}`))) continue;
      const t1 = t0 + Math.max(0, length);
      // Journée entière : affichée par sa date, sans fuseau (jours du serveur).
      const s0 = allDay ? toInstant(wall, 'LOCAL') : t0;
      const s1 = allDay ? toInstant(wall + Math.max(length, DAY), 'LOCAL') : t1;
      if (s1 <= from || s0 > to) continue;
      out.push({
        title: e.SUMMARY ? unescape(e.SUMMARY.value) : '—',
        location: e.LOCATION ? unescape(e.LOCATION.value) : '',
        allDay,
        start: allDay ? new Date(wall).toISOString().slice(0, 10) : new Date(t0).toISOString(),
        end: allDay ? new Date(wall + Math.max(length, DAY)).toISOString().slice(0, 10) : new Date(t1).toISOString(),
        sort: s0,
        calendar,
      });
    }
  }
  return out;
}

async function readCalendar(url, w, from, to, calendar) {
  if (!/^https?:\/\//i.test(url)) throw fail('invalid_url', `URL invalide : ${url}`, { url });
  const headers = { Accept: 'text/calendar, */*;q=0.5', ...(w.username || w.password ? basicAuth(w.username, w.password) : {}) };
  const r = await request(url, { headers });
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie l\'identifiant et le mot de passe)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  return parseCalendar(r.text, from, to, calendar);
}

async function ical(w, now = Date.now()) {
  const urls = String(w.apiKey || '').split(/\s+/).filter(Boolean).slice(0, MAX_CALENDARS);
  if (!urls.length) throw fail('ical_missing', 'Aucune adresse d\'agenda');
  const from = now, to = now + DAYS_AHEAD * DAY;
  const results = await Promise.allSettled(urls.map((u, i) => readCalendar(u, w, from, to, i)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason;
  const events = ok.flatMap((r) => r.value).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  return {
    events: events.slice(0, MAX_EVENTS).map(({ sort, ...e }) => e),
    more: Math.max(0, events.length - MAX_EVENTS),
    calendars: urls.length,
    failed: results.length - ok.length,
  };
}

module.exports = {
  ical: { fields: ['apiKey', 'username', 'password'], cacheMs: 5 * 60_000, fetch: ical, parse: parseCalendar },
};
