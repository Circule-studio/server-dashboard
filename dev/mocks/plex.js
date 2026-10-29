// Faux Plex (jeton plex-token). Comme le vrai, il répond en XML sauf si on demande du JSON.

const { http, json } = require('./lib');

const MIN = 60_000;
const SESSIONS = [
  { type: 'episode', grandparentTitle: 'Severance', parentIndex: 2, index: 4, title: 'Woe’s Hollow',
    duration: 47 * MIN, viewOffset: 31 * MIN, User: { title: 'thomas' }, Player: { title: 'Apple TV', state: 'playing' } },
  { type: 'movie', title: 'Dune: Part Two', year: 2024,
    duration: 166 * MIN, viewOffset: 12 * MIN, User: { title: 'camille' }, Player: { title: 'Chrome', state: 'paused' } },
];
const LIBRARIES = [{ key: '1', title: 'Films', type: 'movie' }, { key: '2', title: 'Séries', type: 'show' }, { key: '3', title: 'Musique', type: 'artist' }];

http.createServer((req, res) => {
  const token = req.headers['x-plex-token'] || new URL(req.url, 'http://x').searchParams.get('X-Plex-Token');
  if (token !== 'plex-token') { res.writeHead(401, { 'Content-Type': 'text/html' }); return res.end('<html><body>401 Unauthorized</body></html>'); }
  const path = req.url.split('?')[0];
  const body = path === '/status/sessions' ? { MediaContainer: { size: SESSIONS.length, Metadata: SESSIONS } }
    : path === '/library/sections' ? { MediaContainer: { size: LIBRARIES.length, Directory: LIBRARIES } } : null;
  if (!body) { res.writeHead(404); return res.end(); }
  if (!(req.headers.accept || '').includes('application/json')) {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><MediaContainer size="${body.MediaContainer.size}"></MediaContainer>`);
  }
  json(res, body);
}).listen(13240);
