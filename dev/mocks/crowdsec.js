// Faux CrowdSec (API locale) : machine dashboard / crowdsec-pass (alertes) et clé de bouncer
// crowdsec-bouncer (décisions). Alertes CAPI et simulées à écarter, comme avec la vraie LAPI.

const { http, json, ago } = require('./lib');

const TOKEN = 'jwt-crowdsec';
const alert = (id, ip, cn, as, scenario, minutes, ban = true) => ({
  id, scenario, simulated: false, events_count: 6, start_at: ago(minutes), created_at: ago(minutes),
  source: { scope: 'Ip', ip, value: ip, cn, as_name: as },
  decisions: ban ? [{ origin: 'crowdsec', type: 'ban', value: ip, duration: '3h59m', scenario }] : [],
});
const ALERTS = [
  alert(1, '185.220.101.4', 'DE', 'Tor exit', 'crowdsecurity/ssh-bf', 3),
  alert(2, '45.148.10.81', 'NL', 'Techoff Srv', 'crowdsecurity/http-probing', 20),
  alert(3, '218.92.0.31', 'CN', 'Chinanet', 'crowdsecurity/ssh-bf', 95),
  alert(4, '103.152.79.12', 'IN', 'Example Host', 'crowdsecurity/http-cve-2021-41773', 300, false),
  { id: 5, scenario: 'update : +15000/-0 IPs', source: { scope: 'crowdsecurity/community-blocklist', value: 'blocklist' }, decisions: [] },
  { ...alert(6, '1.2.3.4', 'US', 'Test', 'crowdsecurity/ssh-bf', 10), simulated: true },
];

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/watchers/login') {
      const b = JSON.parse(body || '{}');
      // Comme la vraie LAPI : un User-Agent sans « nom/version » fait échouer la connexion.
      const badAgent = !/^[^/\s]+\/\S+/.test(req.headers['user-agent'] || '');
      if (badAgent || b.machine_id !== 'dashboard' || b.password !== 'crowdsec-pass') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"code":401,"message":"incorrect Username or Password"}'); }
      return json(res, { code: 200, expire: new Date(Date.now() + 3600e3).toISOString(), token: TOKEN });
    }
    if (req.url.startsWith('/v1/alerts')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(); }
      const url = new URL(req.url, 'http://x');
      const active = url.searchParams.get('has_active_decision') === 'true';
      return json(res, active ? ALERTS.filter((a) => a.decisions?.length) : ALERTS);
    }
    if (req.url.startsWith('/v1/decisions')) {
      if (req.headers['x-api-key'] !== 'crowdsec-bouncer') { res.writeHead(403); return res.end('{"message":"access forbidden"}'); }
      return json(res, [
        { origin: 'CAPI', type: 'ban', value: '9.9.9.9', scenario: 'crowdsecurity/community-blocklist', duration: '160h' },
        { origin: 'crowdsec', type: 'ban', value: '185.220.101.4', scenario: 'crowdsecurity/ssh-bf', duration: '3h59m' },
        { origin: 'cscli', type: 'ban', value: '45.148.10.81', scenario: 'manual \'ban\' from \'admin\'', duration: '23h' },
      ]);
    }
    res.writeHead(404);
    res.end();
  });
}).listen(18093);
