// Fausses métriques d'Authelia (port 18101), au format de sa version 4.39.

const { http } = require('./lib');

const METRICS = `# HELP authelia_authn Number of authentications
# TYPE authelia_authn counter
authelia_authn{banned="false",success="true"} 41
authelia_authn{banned="false",success="false"} 6
authelia_authn{banned="true",success="false"} 2
authelia_authn_second_factor{banned="false",success="true",type="totp"} 30
authelia_authn_second_factor{banned="false",success="false",type="totp"} 3
authelia_authn_second_factor{banned="false",success="true",type="webauthn"} 9
authelia_authz{code="200"} 1200
authelia_authz{code="302"} 40
authelia_authz{code="401"} 15
authelia_authz{code="403"} 4
go_goroutines 18
process_start_time_seconds ${Math.floor(Date.now() / 1000) - 3 * 86400}
`;

http.createServer((req, res) => {
  if (req.url !== '/metrics') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(METRICS);
}).listen(18101);
