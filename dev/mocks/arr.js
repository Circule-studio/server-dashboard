// Faux Sonarr (sonarr-key), Radarr (radarr-key), Lidarr, Readarr, Prowlarr et Bazarr.

const { http, json, day } = require('./lib');

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

// Faux Lidarr (lidarr-key) et Readarr (readarr-key) : API v1, même file d'attente.
const v1 = (key, port, calendar, title) => http.createServer((req, res) => {
  if (req.headers['x-api-key'] !== key) { res.writeHead(401); return res.end(); }
  if (req.url.startsWith('/api/v1/calendar')) return json(res, calendar());
  if (req.url.startsWith('/api/v1/queue')) return json(res, queue(title));
  res.writeHead(404); res.end();
}).listen(port);
v1('lidarr-key', 18686, () => [
  { title: 'Hit Me Hard and Soft (Deluxe)', artist: { artistName: 'Billie Eilish' }, releaseDate: day(9).slice(0, 10) + 'T00:00:00Z', statistics: { trackFileCount: 0 } },
  { title: 'Moon Music', artist: { artistName: 'Coldplay' }, releaseDate: day(-2).slice(0, 10) + 'T00:00:00Z', statistics: { trackFileCount: 10 } },
], 'Coldplay - Moon Music (2026) [FLAC]');
v1('readarr-key', 18787, () => [
  { title: 'Le Mage du Kremlin, tome 2', author: { authorName: 'Giuliano da Empoli' }, releaseDate: day(3).slice(0, 10) + 'T00:00:00Z', statistics: { bookFileCount: 0 } },
], 'Project.Hail.Mary.epub');

// Faux Prowlarr (prowlarr-key) : 4 indexeurs dont un désactivé, un en pause après des échecs.
http.createServer((req, res) => {
  if (req.headers['x-api-key'] !== 'prowlarr-key') { res.writeHead(401); return res.end(); }
  if (req.url === '/api/v1/indexer') return json(res, [
    { id: 1, name: 'YggTorrent', enable: true }, { id: 2, name: '1337x', enable: true },
    { id: 3, name: 'Nyaa', enable: true }, { id: 4, name: 'Ancien', enable: false },
  ]);
  if (req.url === '/api/v1/indexerstatus') return json(res, [
    { indexerId: 2, disabledTill: day(1, 6) }, { indexerId: 3, disabledTill: day(-1) },
  ]);
  if (req.url === '/api/v1/indexerstats') return json(res, { indexers: [
    { indexerId: 1, numberOfQueries: 1520, numberOfGrabs: 84 }, { indexerId: 2, numberOfQueries: 310, numberOfGrabs: 12, numberOfFailedQueries: 40 },
    { indexerId: 3, numberOfQueries: 95, numberOfGrabs: 3 },
  ] });
  res.writeHead(404); res.end();
}).listen(19696);

// Faux Bazarr (bazarr-key) : badges de l'interface.
http.createServer((req, res) => {
  if (req.headers['x-api-key'] !== 'bazarr-key') { res.writeHead(401); return res.end(); }
  if (req.url === '/api/badges') return json(res, { episodes: 37, movies: 4, providers: 1, status: 0 });
  res.writeHead(404); res.end();
}).listen(16767);
