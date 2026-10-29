// Faux AdGuard Home (authentification HTTP Basic).

const { http, json } = require('./lib');

http.createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('admin:adguard-pass').toString('base64')) { res.writeHead(401); return res.end(); }
  if (req.url === '/control/status') return json(res, {
    dns_addresses: ['192.168.1.2'], dns_port: 53, http_port: 80, protection_enabled: true, protection_disabled_duration: 0,
    dhcp_available: true, running: true, version: 'v0.107.65', language: 'fr', start_time: Date.now() - 3 * 86400_000,
  });
  if (req.url.startsWith('/control/stats')) return json(res, {
    time_units: 'hours', num_dns_queries: 61542, num_blocked_filtering: 7214, num_replaced_safebrowsing: 12,
    num_replaced_safesearch: 40, num_replaced_parental: 3, avg_processing_time: 0.0123,
    top_queried_domains: [], top_clients: [], top_blocked_domains: [], dns_queries: [], blocked_filtering: [],
  });
  res.writeHead(404); res.end();
}).listen(13000);
