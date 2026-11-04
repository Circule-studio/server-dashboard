// Faux Loki (port 18100, sans authentification) : labels, métriques et lignes d'erreur.
// Sur le port 18103, protégé : utilisateur loki / loki-pass ou jeton loki-token (comme via Grafana).

const { http, json } = require('./lib');

const success = (data) => ({ status: 'success', data });
const vector = (result) => success({ resultType: 'vector', result });
const value = (n, metric = {}) => ({ metric, value: [Date.now() / 1000, String(n)] });

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api\/datasources\/proxy\/uid\/[^/]+/, '');
  const q = url.searchParams.get('query') || '';
  if (path === '/loki/api/v1/labels') return json(res, success(['__stream_shard__', 'filename', 'job']));
  if (path === '/loki/api/v1/query') {
    if (q.includes('pas{valide')) { res.writeHead(400); return res.end(JSON.stringify({ message: 'parse error at line 1' })); }
    if (q.startsWith('topk(')) return json(res, vector([value(9000, { job: 'caddy' }), value(3456, { job: 'immich' })]));
    if (q.startsWith('sum(bytes_over_time')) return json(res, vector([value(52428800)]));
    if (q.includes('|~')) return json(res, vector([value(42)]));
    return json(res, vector([value(12456)]));
  }
  if (path === '/loki/api/v1/query_range') {
    const ns = (min) => `${Date.now() - min * 60_000}000000`;
    return json(res, success({ resultType: 'streams', result: [
      { stream: { job: 'caddy' }, values: [[ns(5), '\u001b[31mERROR\u001b[0m upstream timed out'], [ns(90), 'error: connection refused']] },
      { stream: { job: 'immich' }, values: [[ns(30), `FATAL ${'x'.repeat(500)}`]] },
    ] }));
  }
  res.writeHead(404);
  res.end();
}

http.createServer(handler).listen(18100);
http.createServer((req, res) => {
  const auth = req.headers.authorization;
  if (auth !== 'Bearer loki-token' && auth !== `Basic ${Buffer.from('loki:loki-pass').toString('base64')}`) { res.writeHead(401); return res.end(); }
  handler(req, res);
}).listen(18103);
