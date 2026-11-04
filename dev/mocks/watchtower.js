// Faux Watchtower (port 18102), jeton watchtower-token. Chaque lecture ajoute un passage quand
// on appelle POST /__mock/scan, pour tester la détection du dernier passage.

const { http } = require('./lib');

let scans = 12;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__mock/scan') { scans++; res.writeHead(204); return res.end(); }
  if (req.headers.authorization !== 'Bearer watchtower-token') { res.writeHead(401); return res.end(); }
  if (req.url !== '/v1/metrics') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`# TYPE watchtower_containers_scanned gauge
watchtower_containers_scanned 9
watchtower_containers_updated 3
watchtower_containers_failed 1
# TYPE watchtower_scans_total counter
watchtower_scans_total ${scans}
watchtower_scans_skipped 2
`);
}).listen(18102);
