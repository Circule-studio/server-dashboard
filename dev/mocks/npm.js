// Faux Nginx Proxy Manager.

const { http, json } = require('./lib');

// POST /__expire (réservé aux tests) révoque les jetons : le dashboard doit se reconnecter.
const npmTokens = new Set();
const npmDate = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__expire') { npmTokens.clear(); res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && req.url === '/api/tokens') {
    let b = ''; req.on('data', (d) => (b += d));
    return req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { /* corps invalide */ }
      if (body.identity !== 'admin@example.com' || body.secret !== 'npm-pass') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"error":{"code":401,"message":"Invalid email or password"}}');
      }
      const token = `npm-${Math.random().toString(36).slice(2)}`;
      npmTokens.add(token);
      console.log(`NPM : connexion (${npmTokens.size} jeton(s))`);
      json(res, { token, expires: new Date(Date.now() + 864e5).toISOString() });
    });
  }
  if (!npmTokens.has((req.headers.authorization || '').replace('Bearer ', ''))) { res.writeHead(401); return res.end('{"error":{"code":401}}'); }
  if (req.url.startsWith('/api/nginx/proxy-hosts')) return json(res, [
    ...['jellyfin', 'immich', 'sonarr', 'radarr', 'cloud'].map((n, i) => ({ id: i + 1, domain_names: [`${n}.maison.fr`], enabled: true })),
    { id: 6, domain_names: ['ancien.maison.fr'], enabled: false },
    { id: 7, domain_names: ['ha.maison.fr'], enabled: 1 }, // anciennes versions : 1 / 0
  ]);
  if (req.url.startsWith('/api/nginx/certificates')) return json(res, [
    { id: 1, nice_name: 'maison.fr', domain_names: ['maison.fr', '*.maison.fr'], provider: 'letsencrypt', expires_on: npmDate(62) },
    { id: 2, nice_name: '', domain_names: ['ha.maison.fr'], provider: 'letsencrypt', expires_on: npmDate(5) },
    { id: 3, nice_name: 'vieux.maison.fr', domain_names: ['vieux.maison.fr'], provider: 'letsencrypt', expires_on: npmDate(-2) },
    { id: 4, nice_name: 'Certificat interne', domain_names: ['nas.lan'], provider: 'other', expires_on: npmDate(300) },
  ]);
  res.writeHead(404); res.end();
}).listen(10081);
