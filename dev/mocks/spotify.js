// Faux Spotify (port 18104) : comptes et API. Application client-id / client-secret. Le code
// d'autorisation est code-ok, le jeton de rafraîchissement refresh-spotify (refresh-expire : expiré).
// POST /__mock/player/idle ou /playing : plus rien en cours, ou de nouveau un titre.

const { http, json } = require('./lib');

let idle = false;
const image = (w) => ({ url: `https://i.scdn.co/image/${w}`, width: w, height: w });
const TRACK = {
  type: 'track', name: 'Paranoid Android', duration_ms: 387000, external_urls: { spotify: 'https://open.spotify.com/track/abc' },
  artists: [{ name: 'Radiohead' }], album: { name: 'OK Computer', images: [image(640), image(300), image(64)] },
};
const played = (name, min) => ({ played_at: new Date(Date.now() - min * 60_000).toISOString(), track: { ...TRACK, name } });

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    if (url.pathname === '/__mock/player/idle') { idle = true; res.writeHead(204); return res.end(); }
    if (url.pathname === '/__mock/player/playing') { idle = false; res.writeHead(204); return res.end(); }
    if (url.pathname === '/api/token') {
      if (req.headers.authorization !== `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'invalid_client' }));
      }
      const p = new URLSearchParams(body);
      const okCode = p.get('grant_type') === 'authorization_code' && p.get('code') === 'code-ok' && p.get('redirect_uri') === 'http://127.0.0.1:8888/callback';
      if (okCode) return json(res, { access_token: 'access-spotify', expires_in: 3600, refresh_token: 'refresh-spotify' });
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'refresh-spotify') return json(res, { access_token: 'access-spotify', expires_in: 3600 });
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    if (req.headers.authorization !== 'Bearer access-spotify') { res.writeHead(401); return res.end(); }
    if (url.pathname === '/v1/me/player') {
      if (idle) { res.writeHead(204); return res.end(); }
      return json(res, { is_playing: true, progress_ms: 95000, device: { name: 'Salon' }, item: TRACK });
    }
    if (url.pathname === '/v1/me/player/recently-played') return json(res, { items: [played('Karma Police', 12), played('Airbag', 20)] });
    res.writeHead(404);
    res.end();
  });
}).listen(18104);
