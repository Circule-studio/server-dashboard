// Faux services pour développer les widgets sans installer Jellyfin & co.
// Lancer : npm run mocks, puis ajouter les widgets dans le dashboard avec :
//   Jellyfin     http://localhost:18096  clé API  jf-key
//   qBittorrent  http://localhost:18080  admin / secret
//   Sonarr       http://localhost:18989  clé API  sonarr-key
//   Radarr       http://localhost:17878  clé API  radarr-key
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

console.log('mocks prêts');
