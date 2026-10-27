// Faux services pour développer les widgets sans installer Jellyfin & co.
// Lancer : npm run mocks, puis ajouter les widgets dans le dashboard avec :
//   Jellyfin     http://localhost:18096  clé API  jf-key
//   qBittorrent  http://localhost:18080  admin / secret
//   Sonarr       http://localhost:18989  clé API  sonarr-key
//   Radarr       http://localhost:17878  clé API  radarr-key
//   Proxmox VE   http://localhost:18006  jeton    root@pam!dashboard / pve-secret
//   Pulse        http://localhost:17655  jeton    pulse-token
//   Météo        http://localhost:18765  lieu     Nantes, Paris (ou des coordonnées « 47.21, -1.55 »)
// Faux Docker : lancer le dashboard avec la variable DOCKER_SOCKET affichée au démarrage.
const http = require('http');
const day = (n, h = 0) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  if (req.headers['x-emby-token'] !== 'jf-key') { res.writeHead(401); return res.end(); }
  if (req.url.startsWith('/Sessions')) return json(res, [
    { UserName: 'thomas', DeviceName: 'TV Salon', PlayState: { PositionTicks: 3.1e10, IsPaused: false },
      NowPlayingItem: { Type: 'Episode', SeriesName: 'The Expanse', ParentIndexNumber: 2, IndexNumber: 5, Name: 'Home', RunTimeTicks: 5.4e10 } },
    { UserName: 'invité', DeviceName: 'Firefox', PlayState: { PositionTicks: 1e10, IsPaused: true },
      NowPlayingItem: { Type: 'Movie', Name: 'Dune', ProductionYear: 2021, RunTimeTicks: 9.3e10 } },
    { UserName: 'idle', DeviceName: 'Phone' },
  ]);
  if (req.url.startsWith('/Items/Counts')) return json(res, { MovieCount: 412, SeriesCount: 57, EpisodeCount: 2318 });
  res.writeHead(404); res.end();
}).listen(18096);

http.createServer((req, res) => {
  if (req.url === '/api/v2/auth/login') {
    let b = ''; req.on('data', (d) => (b += d));
    return req.on('end', () => {
      if (b.includes('username=admin') && b.includes('password=secret')) { res.writeHead(200, { 'Set-Cookie': 'SID=abc; path=/' }); res.end('Ok.'); }
      else { res.writeHead(200); res.end('Fails.'); }
    });
  }
  if (!(req.headers.cookie || '').includes('SID=abc')) { res.writeHead(403); return res.end(); }
  if (req.url.startsWith('/api/v2/transfer/info')) return json(res, { dl_info_speed: 12_400_000, up_info_speed: 850_000 });
  if (req.url.startsWith('/api/v2/torrents/info')) return json(res, [
    { name: 'debian-13.1.0-amd64-netinst.iso', progress: 1, dlspeed: 0, upspeed: 450000, eta: 8640000, size: 7.5e8, state: 'uploading' },
    { name: 'ubuntu-26.04-desktop-amd64.iso', progress: 0.62, dlspeed: 9_800_000, upspeed: 120000, eta: 340, size: 6.1e9, state: 'downloading' },
    { name: 'archlinux-2026.10.01-x86_64.iso', progress: 0.18, dlspeed: 2_600_000, upspeed: 0, eta: 1520, size: 1.2e9, state: 'downloading' },
    { name: 'Big.Buck.Bunny.1080p.mkv', progress: 0.4, dlspeed: 0, upspeed: 0, eta: 8640000, size: 9e8, state: 'pausedDL' },
  ]);
  res.writeHead(404); res.end();
}).listen(18080);

const queue = (title) => ({ totalRecords: 2, records: [
  { title, size: 4e9, sizeleft: 1.2e9, trackedDownloadState: 'downloading', timeleft: '00:12:30' },
  { title: title + ' (2)', size: 2e9, sizeleft: 2e9, status: 'queued' },
] });

http.createServer((req, res) => {
  if (req.headers['x-api-key'] !== 'sonarr-key') { res.writeHead(401); return res.end(); }
  if (req.url.startsWith('/api/v3/calendar')) return json(res, [
    { series: { title: 'Severance' }, seasonNumber: 3, episodeNumber: 2, title: 'Hello, Ms. Cobel', airDateUtc: day(0, 21), hasFile: true },
    { series: { title: 'Andor' }, seasonNumber: 2, episodeNumber: 8, title: 'Who Are You?', airDateUtc: day(1, 3), hasFile: false },
    { series: { title: 'The Bear' }, seasonNumber: 5, episodeNumber: 1, title: '', airDateUtc: day(4, 2), hasFile: false },
  ]);
  if (req.url.startsWith('/api/v3/queue')) return json(res, queue('The.Last.of.Us.S03E01.1080p'));
  res.writeHead(404); res.end();
}).listen(18989);

http.createServer((req, res) => {
  if (req.headers['x-api-key'] !== 'radarr-key') { res.writeHead(401); return res.end(); }
  if (req.url.startsWith('/api/v3/calendar')) return json(res, [
    { title: 'Dune: Part Three', year: 2026, inCinemas: day(-30), digitalRelease: day(6).slice(0, 10) + 'T00:00:00Z', hasFile: false },
    { title: 'Project Hail Mary', year: 2026, physicalRelease: day(2).slice(0, 10) + 'T00:00:00Z', hasFile: true },
  ]);
  if (req.url.startsWith('/api/v3/queue')) return json(res, queue('Oppenheimer.2023.2160p'));
  res.writeHead(404); res.end();
}).listen(17878);

// ---------- Faux Proxmox VE ----------
const GB = 1024 ** 3;
http.createServer((req, res) => {
  if (req.headers.authorization !== 'PVEAPIToken=root@pam!dashboard=pve-secret') { res.writeHead(401); return res.end(); }
  if (!req.url.startsWith('/api2/json/cluster/resources')) { res.writeHead(404); return res.end(); }
  const cpu = 0.18 + Math.random() * 0.1;
  json(res, { data: [
    { type: 'node', node: 'pve', status: 'online', cpu, maxcpu: 16, mem: 41 * GB, maxmem: 64 * GB, disk: 38 * GB, maxdisk: 94 * GB, uptime: 1_036_800 },
    { type: 'lxc', vmid: 100, name: 'photo-server', node: 'pve', status: 'running', cpu: 0.04, maxcpu: 2, mem: 1.2 * GB, maxmem: 4 * GB },
    { type: 'lxc', vmid: 101, name: 'obsidian-livesync', node: 'pve', status: 'running', cpu: 0.01, maxcpu: 1, mem: 0.3 * GB, maxmem: 1 * GB },
    { type: 'lxc', vmid: 102, name: 'pulse', node: 'pve', status: 'running', cpu: 0.02, maxcpu: 1, mem: 0.2 * GB, maxmem: 1 * GB },
    { type: 'qemu', vmid: 110, name: 'home-assistant', node: 'pve', status: 'running', cpu: 0.06, maxcpu: 2, mem: 2.9 * GB, maxmem: 4 * GB },
    { type: 'qemu', vmid: 120, name: 'windows-11', node: 'pve', status: 'stopped', cpu: 0, maxcpu: 4, mem: 0, maxmem: 8 * GB },
    { type: 'lxc', vmid: 9000, name: 'debian-template', node: 'pve', status: 'stopped', template: 1 },
    { type: 'storage', storage: 'local', node: 'pve', status: 'available', disk: 38 * GB, maxdisk: 94 * GB },
    { type: 'storage', storage: 'local-lvm', node: 'pve', status: 'available', disk: 612 * GB, maxdisk: 832 * GB },
  ] });
}).listen(18006);

// ---------- Faux Pulse (format de l'API Pulse v6) ----------
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
http.createServer((req, res) => {
  if (req.headers['x-api-token'] !== 'pulse-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
  if (req.url.startsWith('/api/state/summary')) return json(res, {
    activeAlerts: 2, nodes: 1, vms: 2, containers: 4,
    dockerHosts: [{ name: 'photo-server', containers: 6, uptimeSeconds: 86400, cpuUsagePercent: 4 }],
    verdicts: { ok: 5, attention: 1, critical: 1, stale: 0, off: 1, unknown: 0 },
    attention: [
      { id: 'storage-backup', name: 'backup', type: 'storage', verdict: 'critical', topReason: { code: 'disk-usage-high' } },
      { id: 'lxc-102', name: 'pulse', type: 'system-container', verdict: 'attention', topReason: { code: 'memory-high' } },
    ],
    lastUpdate: new Date().toISOString(),
  });
  if (req.url.startsWith('/api/alerts/active')) return json(res, [
    { id: 'a1', type: 'disk', level: 'critical', resourceId: 'storage-backup', resourceName: 'backup', node: 'pve',
      message: 'Storage backup is 94% full', summary: 'Disque à 94 %', value: 94, threshold: 90, startTime: ago(180), acknowledged: false },
    { id: 'a2', type: 'memory', level: 'warning', resourceId: 'lxc-102', resourceName: 'pulse', node: 'pve',
      message: 'Container pulse memory at 86%', summary: 'Mémoire à 86 %', value: 86, threshold: 85, startTime: ago(25), acknowledged: true },
  ]);
  if (req.url.startsWith('/api/resources')) {
    const r = (id, type, name, status, cpu, mem, verdict = 'ok') => ({
      id, type, name, status, health: { verdict }, parentName: type === 'agent' ? '' : 'pve',
      metrics: cpu == null ? undefined : { cpu: { value: cpu, percent: cpu }, memory: { value: mem, percent: mem } },
    });
    const data = [
      r('node-pve', 'agent', 'pve', 'online', 21, 64),
      r('lxc-100', 'system-container', 'photo-server', 'online', 4, 30),
      r('lxc-101', 'system-container', 'obsidian-livesync', 'online', 1, 31),
      r('lxc-102', 'system-container', 'pulse', 'warning', 3, 86, 'attention'),
      r('lxc-103', 'system-container', 'twingate-connector', 'online', 0, 11),
      r('vm-110', 'vm', 'home-assistant', 'online', 6, 73),
      r('vm-120', 'vm', 'windows-11', 'offline', null, null, 'off'),
    ];
    return json(res, { data, meta: { page: 1, limit: 100, total: data.length, totalPages: 1 }, aggregations: {} });
  }
  res.writeHead(404); res.end();
}).listen(17655);

// ---------- Faux Open-Meteo (prévisions + géocodage, même format que l'API publique) ----------
const PLACES = [
  { id: 2990969, name: 'Nantes', latitude: 47.21725, longitude: -1.55336, country_code: 'FR', country: 'France', admin1: 'Pays de la Loire', timezone: 'Europe/Paris' },
  { id: 2988507, name: 'Paris', latitude: 48.85341, longitude: 2.3488, country_code: 'FR', country: 'France', admin1: 'Île-de-France', timezone: 'Europe/Paris' },
];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const bad = (reason) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: true, reason })); };
  if (u.pathname === '/v1/search') {
    const name = (u.searchParams.get('name') || '').split(',')[0].trim().toLowerCase();
    const found = name.length >= 2 ? PLACES.filter((p) => p.name.toLowerCase().startsWith(name)) : [];
    // Comme l'API réelle : sans résultat, la clé `results` est absente.
    return json(res, found.length ? { results: found.slice(0, Number(u.searchParams.get('count')) || 10), generationtime_ms: 0.4 } : { generationtime_ms: 0.3 });
  }
  if (u.pathname === '/v1/forecast') {
    const lat = Number(u.searchParams.get('latitude')), lon = Number(u.searchParams.get('longitude'));
    if (!u.searchParams.has('latitude') || Number.isNaN(lat)) return bad('Parameter \'latitude\' and \'longitude\' must have the same number of elements');
    const codes = [2, 61, 80, 3, 0];
    const now = new Date();
    return json(res, {
      latitude: lat, longitude: lon, generationtime_ms: 0.1, utc_offset_seconds: 3600, timezone: 'Europe/Paris', timezone_abbreviation: 'GMT+1', elevation: 20,
      current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', weather_code: 'wmo code', wind_speed_10m: 'km/h', is_day: '' },
      current: { time: now.toISOString().slice(0, 16), interval: 900, temperature_2m: 13.4, apparent_temperature: 11.2, weather_code: 2, wind_speed_10m: 17.6, is_day: 1 },
      daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
      daily: {
        time: codes.map((_, i) => day(i, 12).slice(0, 10)),
        weather_code: codes,
        temperature_2m_max: [15.1, 13.8, 12.2, 14.6, 16.9],
        temperature_2m_min: [8.3, 9.1, 7.4, 6.2, 5.8],
        precipitation_probability_max: [10, 85, 60, 25, 0],
      },
    });
  }
  res.writeHead(404); res.end();
}).listen(18765);

// ---------- Faux Docker (API Engine sur un named pipe / socket unix) ----------
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

console.log('mocks prêts');
console.log(`Faux Docker : DOCKER_SOCKET=${DOCKER_SOCKET}`);
