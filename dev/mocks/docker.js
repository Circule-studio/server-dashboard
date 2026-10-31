// Faux Docker (API Engine sur un named pipe / socket unix).

const { http, json } = require('./lib');

const containers = [
  ['jellyfin', 'jellyfin/jellyfin:10.11', 'running', 'Up 3 days'],
  ['sonarr', 'linuxserver/sonarr:latest', 'running', 'Up 3 days'],
  ['radarr', 'linuxserver/radarr:latest', 'running', 'Up 3 days'],
  ['qbittorrent', 'linuxserver/qbittorrent:latest', 'running', 'Up 26 hours'],
  ['nextcloud', 'nextcloud:31-apache', 'running', 'Up 5 days'],
  ['immich-server', 'ghcr.io/immich-app/immich-server:release', 'exited', 'Exited (0) 2 hours ago'],
].map(([name, image, state, status], i) => ({ Id: (i + 1).toString(16).repeat(64).slice(0, 64), Names: ['/' + name], Image: image, State: state, Status: status }));

const DOCKER_SOCKET = process.platform === 'win32'
  ? '\\\\.\\pipe\\server-dashboard-mock-docker'
  : require('path').join(require('os').tmpdir(), 'server-dashboard-mock-docker.sock');
if (process.platform !== 'win32') { try { require('fs').unlinkSync(DOCKER_SOCKET); } catch {} }

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/containers/json')) return json(res, containers);
  // Mesure de `docker stats` (stream=false) : CPU entre deux relevés, mémoire avec son cache.
  const stats = req.url.match(/^\/containers\/([a-f0-9]+)\/stats/);
  const sc = stats && containers.find((x) => x.Id.startsWith(stats[1]));
  if (req.method === 'GET' && sc) {
    const i = containers.indexOf(sc) + 1;
    return json(res, {
      cpu_stats: { cpu_usage: { total_usage: 5e9 + i * 3e7 }, system_cpu_usage: 4e11 + 1e9, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 5e9 }, system_cpu_usage: 4e11 },
      memory_stats: { usage: i * 300e6 + 50e6, limit: 16e9, stats: { inactive_file: 50e6 } },
    });
  }
  const m = req.url.match(/^\/containers\/([a-f0-9]+)\/(start|stop|restart)$/);
  const c = m && containers.find((x) => x.Id.startsWith(m[1]));
  if (req.method === 'POST' && c) {
    const up = m[2] !== 'stop';
    c.State = up ? 'running' : 'exited';
    c.Status = up ? 'Up Less than a second' : 'Exited (0) Less than a second ago';
    res.writeHead(204); return res.end();
  }
  res.writeHead(404); res.end();
}).listen(DOCKER_SOCKET);

module.exports = { DOCKER_SOCKET };
