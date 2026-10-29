// Immich.
// Clé API d'un compte administrateur : la route est réservée aux admins et une clé
// limitée doit avoir la permission server.statistics (sinon HTTP 403).

const { join, getJson } = require('./lib');

async function immich(w) {
  const s = await getJson(join(w.url, '/api/server/statistics'), { 'x-api-key': w.apiKey }, { forbidden: 'immich_admin' });
  return {
    photos: s.photos, videos: s.videos, usage: s.usage,
    users: (s.usageByUser || [])
      .map((u) => ({ name: u.userName, photos: u.photos, videos: u.videos, usage: u.usage, quota: u.quotaSizeInBytes ?? null }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 8),
  };
}

module.exports = {
  immich: { fields: ['url', 'apiKey'], cacheMs: 60_000, fetch: immich },
};
