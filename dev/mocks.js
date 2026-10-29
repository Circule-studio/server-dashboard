// Faux services pour développer les widgets sans installer Jellyfin & co.
// Lancer : npm run mocks, puis ajouter les widgets dans le dashboard avec :
//   Jellyfin     http://localhost:18096  clé API  jf-key
//   qBittorrent  http://localhost:18080  admin / secret
//   Sonarr       http://localhost:18989  clé API  sonarr-key
//   Radarr       http://localhost:17878  clé API  radarr-key
//   Proxmox VE   http://localhost:18006  jeton    root@pam!dashboard / pve-secret
//   Pulse        http://localhost:17655  jeton    pulse-token
//   Météo        http://localhost:18765  lieu     Nantes, Paris (ou des coordonnées « 47.21, -1.55 »)
//   Immich       http://localhost:12283  clé API  immich-key (immich-user-key : compte non admin, refusé)
//   Pi-hole v6   http://localhost:10080  mot de passe  pihole-pass (2fa-pass : 2FA activée, refusé sans code)
//   AdGuard Home http://localhost:13000  admin / adguard-pass
//   GitHub       http://localhost:14000  dépôt  circule-studio/server-dashboard (jeton facultatif)
//                demo/private (jeton gh-token obligatoire), demo/tags-only, demo/empty, demo/rate-limited, demo/secondary
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

// ---------- Faux Immich (GET /api/server/statistics, réservé aux admins) ----------
http.createServer((req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== 'immich-key' && key !== 'immich-user-key') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"message":"Invalid API key","error":"Unauthorized","statusCode":401}'); }
  if (req.url !== '/api/server/statistics') { res.writeHead(404); return res.end(); }
  if (key === 'immich-user-key') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"message":"Forbidden","error":"Forbidden","statusCode":403}'); }
  const user = (userName, photos, videos, usagePhotos, usageVideos, quotaSizeInBytes = null) => ({
    userId: require('crypto').randomUUID(), userName, photos, videos, usage: usagePhotos + usageVideos, usagePhotos, usageVideos, quotaSizeInBytes,
  });
  const usageByUser = [
    user('Thomas', 48213, 1904, 412 * GB, 389 * GB),
    user('Camille', 15377, 622, 96 * GB, 71 * GB, 200 * GB),
    user('Invité', 312, 12, 1.1 * GB, 0.4 * GB, 2 * GB),
  ].map((u) => ({ ...u, usage: Math.round(u.usage), usagePhotos: Math.round(u.usagePhotos), usageVideos: Math.round(u.usageVideos) }));
  const sum = (k) => usageByUser.reduce((n, u) => n + u[k], 0);
  json(res, { photos: sum('photos'), videos: sum('videos'), usage: sum('usage'), usagePhotos: sum('usagePhotos'), usageVideos: sum('usageVideos'), usageByUser });
}).listen(12283);

// ---------- Faux Pi-hole v6 (sessions limitées comme le vrai : « API seats ») ----------
// Chaque connexion est affichée dans la console : le dashboard doit réutiliser sa session.
// POST /__expire (réservé aux tests) fait expirer toutes les sessions.
const piSessions = new Set();
const PI_MAX_SESSIONS = 3;
http.createServer((req, res) => {
  const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...obj, took: 0.001 })); };
  const session = (valid, sid = null) => ({ session: { valid, totp: false, sid, csrf: sid ? 'csrf-' + sid : null, validity: valid ? 1800 : -1, message: valid ? 'correct password' : 'password incorrect' } });
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/__expire') { piSessions.clear(); return reply(200, {}); }
    if (req.url === '/api/auth' && req.method === 'POST') {
      let password;
      try { password = JSON.parse(body).password; } catch { return reply(400, { error: { key: 'bad_request', message: 'No valid JSON payload found', hint: null } }); }
      if (password === '2fa-pass') return reply(400, { error: { key: 'bad_request', message: 'No 2FA token found in JSON payload', hint: null } });
      if (password !== 'pihole-pass') return reply(401, session(false));
      if (piSessions.size >= PI_MAX_SESSIONS) return reply(429, { error: { key: 'api_seats_exceeded', message: 'API seats exceeded', hint: 'increase webserver.api.max_sessions' } });
      const sid = require('crypto').randomBytes(16).toString('base64');
      piSessions.add(sid);
      console.log(`pihole: nouvelle session (${piSessions.size} ouverte(s))`);
      return reply(200, session(true, sid));
    }
    const sid = req.headers['x-ftl-sid'];
    if (req.url === '/api/auth' && req.method === 'DELETE') {
      if (piSessions.delete(sid)) console.log(`pihole: session fermée (${piSessions.size} ouverte(s))`);
      res.writeHead(204); return res.end();
    }
    if (!piSessions.has(sid)) return reply(401, { error: { key: 'unauthorized', message: 'Unauthorized', hint: null } });
    if (req.url === '/api/stats/summary') return reply(200, {
      queries: { total: 48213, blocked: 9876, percent_blocked: 20.48389, unique_domains: 3120, forwarded: 30120, cached: 8217, frequency: 0.6 },
      clients: { active: 14, total: 22 },
      gravity: { domains_being_blocked: 1_234_567, last_update: Math.floor(Date.now() / 1000) - 86400 },
    });
    if (req.url === '/api/dns/blocking') return reply(200, { blocking: 'disabled', timer: 272.5 });
    reply(404, { error: { key: 'not_found', message: 'Not found', hint: null } });
  });
}).listen(10080);

// ---------- Faux AdGuard Home (authentification HTTP Basic) ----------
http.createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('admin:adguard-pass').toString('base64')) { res.writeHead(401); return res.end(); }
  if (req.url === '/control/status') return json(res, {
    dns_addresses: ['192.168.1.2'], dns_port: 53, http_port: 80, protection_enabled: true, protection_disabled_duration: 0,
    dhcp_available: true, running: true, version: 'v0.107.65', language: 'fr', start_time: Date.now() - 3 * 86400_000,
  });
  if (req.url.startsWith('/control/stats')) return json(res, {
    time_units: 'hours', num_dns_queries: 61542, num_blocked_filtering: 7214, num_replaced_safebrowsing: 12,
    num_replaced_safesearch: 40, num_replaced_parental: 3, avg_processing_time: 0.0123,
    top_queried_domains: [], top_clients: [], top_blocked_domains: [], dns_queries: [], blocked_filtering: [],
  });
  res.writeHead(404); res.end();
}).listen(13000);

// ---------- Faux GitHub (API REST v3) ----------
// Sans jeton, demo/private répond 404 comme le vrai GitHub ; un mauvais jeton répond 401.
// Comme le vrai, il envoie un ETag et répond 304 à If-None-Match. Chaque requête est comptée dans la
// console (« GitHub : n requêtes ») pour vérifier que le dashboard ménage la limite.
// POST /__limit (réservé aux tests) simule la limite atteinte pendant 1 h ; un 2e appel la lève.
// POST /__limit?search ne limite que la recherche (issues et PR), qui a sa propre limite chez GitHub.
// demo/secondary répond toujours par la limite secondaire (retry-after de 30 s).
// Dates figées au lancement : une réponse identique garde le même ETag.
const ghStart = Date.now();
const ghAgo = (min) => new Date(ghStart - min * 60_000).toISOString();
let ghRequests = 0;
let ghLimitedUntil = 0;
let ghSearchLimitedUntil = 0;
const ghJson = (req, res, obj) => {
  const body = JSON.stringify(obj);
  const etag = `"${require('crypto').createHash('sha1').update(body).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) { console.log('GitHub : 304 inchangé'); res.writeHead(304, { ETag: etag }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
  res.end(body);
};
const ghUser = (login) => ({ login });
const ghIssue = (number, title, created, labels = [], extra = {}) => ({
  number, title, html_url: `https://github.com/circule-studio/server-dashboard/issues/${number}`,
  user: ghUser('thomas370'), created_at: ago(created), comments: 2, labels, ...extra,
});
const GH_REPOS = {
  'circule-studio/server-dashboard': {
    private: false, stars: 214, releases: [
      ['v0.9.0-beta.1', 60 * 5, true], ['v0.8.0', 60 * 26], ['v0.7.0', 60 * 50], ['v0.6.1', 60 * 74], ['v0.6.0', 60 * 75],
    ], unreleased: 3,
    issues: [
      ghIssue(63, 'Nouveau widget : GitHub (suivre les versions et les issues d\'un projet)', 40, [{ name: 'widget', color: '0e8a16' }, { name: 'enhancement', color: 'a2eeef' }]),
      ghIssue(48, 'Un fichier par intégration (serveur, interface, faux service)', 60 * 50, [{ name: 'help wanted', color: '008672' }]),
      ghIssue(47, 'Garder la config en mémoire au lieu de relire config.json à chaque requête', 60 * 50),
      ghIssue(46, 'check-i18n : les clés écrites dans une condition ne sont pas vérifiées', 60 * 51, [{ name: 'good first issue', color: '7057ff' }]),
      ghIssue(45, 'Tester automatiquement les widgets en CI avec les faux services', 60 * 51),
    ], issueCount: 11,
    pulls: [
      ghIssue(64, 'Widget GitHub', 12, [], { draft: false }),
      ghIssue(60, 'Thème : couleurs d\'accent personnalisées', 60 * 30, [], { draft: true }),
    ], pullCount: 2,
  },
  'demo/private': { private: true, stars: 0, releases: [['1.2.0', 60 * 24 * 9]], unreleased: 0, issues: [], issueCount: 0, pulls: [], pullCount: 0, token: true },
  'demo/tags-only': { private: false, stars: 7, releases: [], tags: ['v2.9.0', 'v2.10.0', 'v2.1.0'], unreleased: 12, issues: [], issueCount: 0, pulls: [], pullCount: 0 },
  'demo/empty': { private: false, stars: 0, releases: [], tags: [], empty: true, issues: [], issueCount: 0, pulls: [], pullCount: 0 },
};
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/__limit')) {
    const search = req.url.endsWith('?search');
    const until = (search ? ghSearchLimitedUntil : ghLimitedUntil) > Date.now() ? 0 : Date.now() + 60 * 60_000;
    if (search) ghSearchLimitedUntil = until; else ghLimitedUntil = until;
    console.log(`GitHub : limite${search ? ' de la recherche' : ''} ${until ? 'simulée pendant 1 h' : 'levée'}`);
    res.writeHead(204); return res.end();
  }
  console.log(`GitHub : ${++ghRequests} requêtes (${req.url.split('?')[0]})`);
  const auth = req.headers.authorization;
  if (auth && auth !== 'Bearer gh-token') { res.writeHead(401); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const limit = u.pathname.startsWith('/search/') ? ghSearchLimitedUntil : ghLimitedUntil;
  if (limit > Date.now()) {
    res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(limit / 1000)) });
    return res.end('{"message":"API rate limit exceeded"}');
  }
  if (u.pathname.startsWith('/repos/demo/secondary')) {
    res.writeHead(403, { 'retry-after': '30', 'x-ratelimit-remaining': '41', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3000) });
    return res.end('{"message":"You have exceeded a secondary rate limit."}');
  }
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); };
  if (u.pathname.startsWith('/repos/demo/rate-limited') || u.searchParams.get('q')?.includes('demo/rate-limited')) {
    res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 25 * 60) });
    return res.end('{"message":"API rate limit exceeded"}');
  }
  if (u.pathname === '/search/issues') {
    const q = u.searchParams.get('q') || '';
    const name = (q.match(/repo:(\S+)/) || [])[1];
    const r = GH_REPOS[name];
    if (!r || (r.token && !auth)) { res.writeHead(422); return res.end('{"message":"Validation Failed"}'); }
    const pr = q.includes('is:pr');
    return ghJson(req, res, { total_count: pr ? r.pullCount : r.issueCount, incomplete_results: false, items: pr ? r.pulls : r.issues });
  }
  const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const r = m && GH_REPOS[m[1]];
  if (!r || (r.token && !auth)) return notFound();
  const html = `https://github.com/${m[1]}`;
  const rest = m[2] || '';
  if (!rest) return ghJson(req, res, {
    full_name: m[1], html_url: html, private: r.private, archived: false, default_branch: 'main',
    stargazers_count: r.stars, forks_count: Math.round(r.stars / 9), pushed_at: ghAgo(35),
  });
  if (rest === '/releases') return ghJson(req, res, r.releases.map(([tag, min, pre]) => ({
    tag_name: tag, name: tag, published_at: ghAgo(min), prerelease: !!pre, draft: false, html_url: `${html}/releases/tag/${tag}`,
  })));
  if (rest === '/tags') return ghJson(req, res, (r.tags || []).map((name) => ({ name })));
  if (rest === '/commits') {
    if (r.empty) { res.writeHead(409); return res.end('{"message":"Git Repository is empty."}'); }
    return ghJson(req, res, [{
      sha: '3f9c2a17b4e8d0c6a5f1e2d3c4b5a69788776655', html_url: `${html}/commit/3f9c2a1`,
      author: ghUser('thomas370'), commit: { message: 'Widget GitHub : versions, issues et PR\n\nDétails…', committer: { date: ghAgo(35) } },
    }]);
  }
  if (rest.startsWith('/compare/')) return ghJson(req, res, { status: r.unreleased ? 'ahead' : 'identical', ahead_by: r.unreleased, behind_by: 0, commits: [] });
  notFound();
}).listen(14000);

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
