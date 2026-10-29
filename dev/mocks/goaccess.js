// Faux GoAccess : rapport JSON réduit (général + visiteurs par jour), servi à toute adresse
// sauf /pas-un-rapport (autre JSON, pour l'erreur).

const { http, json } = require('./lib');

const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv').replaceAll('-', ''); };

http.createServer((req, res) => (req.url === '/pas-un-rapport' ? json(res, { ok: true }) : json(res, {
  general: {
    start_date: '20/Oct/2026', end_date: '29/Oct/2026', total_requests: 14350, valid_requests: 14350,
    unique_visitors: 312, bandwidth: 1_850_000_000, log_path: ['/var/log/caddy/access.log'],
  },
  visitors: {
    metadata: {},
    data: [3, 0, 9, 1, 2, 4, 5, 6, 7, 8].map((n) => ({ data: ymd(n), hits: { count: 100 + n * 7 }, visitors: { count: 40 - n * 3 } })),
  },
}))).listen(17890);
