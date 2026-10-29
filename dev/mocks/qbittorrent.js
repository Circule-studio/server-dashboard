// Faux qBittorrent (admin / secret).

const { http, json } = require('./lib');

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
