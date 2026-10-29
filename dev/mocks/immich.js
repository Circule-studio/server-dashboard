// Faux Immich (GET /api/server/statistics, réservé aux admins).

const { http, json, GB } = require('./lib');

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
