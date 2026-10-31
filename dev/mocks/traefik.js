// Faux Traefik (API) : sans mot de passe sur le port 18094, et derrière un basicAuth (traefik / traefik-pass)
// sur le port 18098. Un routeur en erreur, un en avertissement.

const { http, json } = require('./lib');

const ROUTERS = [
  { name: 'immich@docker', rule: 'Host(`photos.maison.fr`)', status: 'enabled', service: 'immich', provider: 'docker' },
  { name: 'jellyfin@docker', rule: 'Host(`films.maison.fr`)', status: 'enabled', service: 'jellyfin', provider: 'docker' },
  { name: 'nextcloud@file', rule: 'Host(`cloud.maison.fr`)', status: 'disabled', error: ['the service "nextcloud@file" does not exist'], provider: 'file' },
  { name: 'ha@docker', rule: 'Host(`ha.maison.fr`)', status: 'warning', error: ['middleware "auth@file" does not exist'], provider: 'docker' },
];

function api(req, res) {
  if (req.url === '/api/overview') {
    return json(res, {
      http: { routers: { total: 4, warnings: 1, errors: 1 }, services: { total: 5, warnings: 0, errors: 0 }, middlewares: { total: 3, warnings: 0, errors: 1 } },
      tcp: { routers: { total: 1, warnings: 0, errors: 0 }, services: { total: 1, warnings: 0, errors: 0 } },
      udp: { routers: { total: 0, warnings: 0, errors: 0 }, services: { total: 0, warnings: 0, errors: 0 } },
      features: { tracing: '', metrics: 'prometheus', accessLog: true }, providers: ['Docker', 'File'],
    });
  }
  if (req.url === '/api/version') return json(res, { Version: '3.4.1', Codename: 'chaource' });
  if (req.url.startsWith('/api/http/routers')) return json(res, ROUTERS);
  if (req.url === '/api/entrypoints') return json(res, [{ name: 'web', address: ':80' }, { name: 'websecure', address: ':443' }]);
  res.writeHead(404);
  res.end('404 page not found');
}

http.createServer(api).listen(18094);
http.createServer((req, res) => {
  if (req.headers.authorization !== `Basic ${Buffer.from('traefik:traefik-pass').toString('base64')}`) { res.writeHead(401); return res.end(); }
  api(req, res);
}).listen(18098);
