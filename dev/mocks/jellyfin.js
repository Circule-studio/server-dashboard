// Faux Jellyfin (clé API jf-key).

const { http, json } = require('./lib');

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
