// Faux registre d'images Docker (port 18099) : jeton anonyme, puis empreinte de chaque tag.
// demo/web a changé depuis le téléchargement, demo/cache non, demo/private refuse le jeton anonyme.

const { http, json } = require('./lib');

const DIGESTS = { 'demo/web': 'sha256:nouvelle', 'demo/cache': 'sha256:identique' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:18099');
  if (url.pathname === '/token') {
    if (url.searchParams.get('scope') === 'repository:demo/private:pull') { res.writeHead(401); return res.end(); }
    return json(res, { token: 'jeton-anonyme' });
  }
  const m = url.pathname.match(/^\/v2\/(.+)\/manifests\/([^/]+)$/);
  if (!m) { res.writeHead(404); return res.end(); }
  if (req.headers.authorization !== 'Bearer jeton-anonyme') {
    res.writeHead(401, { 'WWW-Authenticate': `Bearer realm="http://localhost:18099/token",service="mock",scope="repository:${m[1]}:pull"` });
    return res.end();
  }
  if (!DIGESTS[m[1]]) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Docker-Content-Digest': DIGESTS[m[1]] });
  res.end();
}).listen(18099);
