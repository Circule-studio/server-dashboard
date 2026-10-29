// Faux Uptime Kuma : page de statut « maison » (publique, sans clé). Une autre page répond 404.

const { http, json } = require('./lib');

const beat = (status, ping, msg = '') => ({ status, time: new Date().toISOString().slice(0, 19).replace('T', ' '), ping, msg });
const MONITORS = [
  [1, 'Jellyfin', beat(1, 42), 0.9998],
  [2, 'Nextcloud', beat(0, null, 'connect ECONNREFUSED 192.168.1.20:443'), 0.9312],
  [3, 'Immich', beat(2, null), 0.995],
  [4, 'Backups', beat(3, null), 1],
  [5, 'Home Assistant', beat(1, 18), 1],
];

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/status-page\/(heartbeat\/)?([^/?]+)$/);
  if (!m || m[2] !== 'maison') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"ok":false,"msg":"Status Page Not Found"}'); }
  if (m[1]) return json(res, {
    heartbeatList: Object.fromEntries(MONITORS.map(([id, , b]) => [id, [beat(1, 30), b]])),
    uptimeList: Object.fromEntries(MONITORS.map(([id, , , u]) => [`${id}_24`, u])),
  });
  json(res, {
    config: { slug: 'maison', title: 'Maison', published: true },
    incident: null,
    publicGroupList: [
      { id: 1, name: 'Médias', monitorList: MONITORS.slice(0, 3).map(([id, name]) => ({ id, name })) },
      // Une sonde peut être dans plusieurs groupes : elle ne doit compter qu'une fois.
      { id: 2, name: 'Maison', monitorList: [MONITORS[0], ...MONITORS.slice(3)].map(([id, name]) => ({ id, name })) },
    ],
    maintenanceList: [],
  });
}).listen(13001);
