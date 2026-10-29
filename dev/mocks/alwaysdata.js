// Faux Alwaysdata : GET /v1/site/ (jeton alwaysdata-token, compte facultatif), et deux faux sites
// en HTTP sur le même port (/ok répond 200, /panne répond 502). Le troisième site ne répond pas.

const { http, json } = require('./lib');

const PORT = 17443;
http.createServer((req, res) => {
  if (req.url === '/ok') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/panne') { res.writeHead(502); return res.end(); }
  const user = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
  if (!/^alwaysdata-token( account=[\w-]+)?:$/.test(user)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end('{"detail":"Invalid token"}');
  }
  if (req.url !== '/v1/site/') { res.writeHead(404); return res.end(); }
  json(res, [
    { id: 1, type: 'php', addresses: [`localhost:${PORT}/ok`, 'www.exemple.fr'], annotation: 'Blog' },
    { id: 2, type: 'nodejs', addresses: [`localhost:${PORT}/panne`] },
    { id: 3, type: 'static', addresses: ['*.exemple.fr', 'localhost:9/'] },
    { id: 4, type: 'redirect', addresses: [] },
  ]);
}).listen(PORT);
