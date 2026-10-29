// Faux agendas iCal : /agenda.ics (événement simple, journée entière, récurrent quotidien avec une
// exception EXDATE et une occurrence déplacée, récurrent hebdomadaire ancien), /prive.ics (HTTP Basic
// agenda / agenda-pass) et /pas-ical (page HTML, pour l'erreur). Dates relatives à aujourd'hui.

const { http } = require('./lib');

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
// AAAAMMJJ du jour n (UTC), et AAAAMMJJTHHMMSS.
const ymd = (n) => { const d = new Date(Date.now() + n * DAY); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const at = (n, h, m = 0) => `${ymd(n)}T${pad(h)}${pad(m)}00`;

const agenda = () => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Server Dashboard//mock//FR',
  'BEGIN:VEVENT', 'UID:simple', `DTSTART:${at(1, 14)}Z`, `DTEND:${at(1, 15, 30)}Z`, 'SUMMARY:Réunion\\, projet dashboard', 'LOCATION:Salle 2', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:journee', `DTSTART;VALUE=DATE:${ymd(2)}`, `DTEND;VALUE=DATE:${ymd(3)}`, 'SUMMARY:Anniversaire de Camille', 'END:VEVENT',
  // Tous les jours à 07:00 UTC pendant 10 jours (de J-3 à J+6), sauf J+3 ; J+4 déplacé à 08:00.
  'BEGIN:VEVENT', 'UID:standup', `DTSTART:${at(-3, 7)}Z`, `DTEND:${at(-3, 7, 15)}Z`, 'RRULE:FREQ=DAILY;COUNT=10',
  `EXDATE:${at(3, 7)}Z`, 'SUMMARY:Point quotidien', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:standup', `RECURRENCE-ID:${at(4, 7)}Z`, `DTSTART:${at(4, 8)}Z`, `DTEND:${at(4, 8, 15)}Z`, 'SUMMARY:Point quotidien (décalé)', 'END:VEVENT',
  // Hebdomadaire depuis des années, le jour J+5 de la semaine : une seule occurrence dans les 7 jours.
  'BEGIN:VEVENT', 'UID:sport', `DTSTART:${ymd(5 - 7 * 300)}T180000Z`, `DTEND:${ymd(5 - 7 * 300)}T190000Z`, 'RRULE:FREQ=WEEKLY', 'SUMMARY:Sport', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:annule', `DTSTART:${at(1, 9)}Z`, 'STATUS:CANCELLED', 'SUMMARY:Annulé', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

http.createServer((req, res) => {
  if (req.url === '/agenda.ics') { res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); return res.end(agenda()); }
  if (req.url === '/prive.ics') {
    if (req.headers.authorization !== `Basic ${Buffer.from('agenda:agenda-pass').toString('base64')}`) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
    return res.end(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:p', `DTSTART:${at(2, 10)}Z`, `DTEND:${at(2, 11)}Z`, 'SUMMARY:Rendez-vous privé', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  }
  if (req.url === '/pas-ical') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>Bonjour</html>'); }
  res.writeHead(404);
  res.end();
}).listen(18091);
