// Faux Speedtest Tracker : API v1 avec le jeton speedtest-token (débits en bit/s), et ancienne API
// publique /api/speedtest/latest (Mbit/s). Un test toutes les 12 h sur 10 jours, dont un en échec.

const { http, json } = require('./lib');

const results = () => Array.from({ length: 20 }, (_, i) => ({
  id: 20 - i,
  ping: 12 + (i % 4),
  download_bits: (850 + (i % 5) * 20) * 1e6,
  upload_bits: (210 + (i % 3) * 10) * 1e6,
  status: i === 3 ? 'failed' : 'completed',
  created_at: new Date(Date.now() - (i * 12 + 2) * 3600e3).toISOString(),
}));

http.createServer((req, res) => {
  if (req.url === '/api/speedtest/latest') return json(res, { data: { ping: 14.2, download: 912.5, upload: 230.1, created_at: new Date(Date.now() - 3600e3).toISOString() } });
  if (req.headers.authorization !== 'Bearer speedtest-token') { res.writeHead(401); return res.end(); }
  if (req.url === '/api/v1/results/latest') return json(res, { data: results()[0] });
  if (req.url.startsWith('/api/v1/results')) return json(res, { data: results() });
  res.writeHead(404); res.end();
}).listen(18766);
