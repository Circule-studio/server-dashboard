// Immich.
// Clé API d'un compte administrateur : la route est réservée aux admins et une clé
// limitée doit avoir la permission server.statistics (sinon HTTP 403).
// Si un module dl-stats (compteur de téléchargements placé devant Immich) répond sur
// la même adresse, on ajoute ses totaux ; sinon le widget reste tel quel.

const { join, getJson } = require('./lib');

async function immich(w) {
  const headers = { 'x-api-key': w.apiKey };
  const [s, downloads] = await Promise.all([
    getJson(join(w.url, '/api/server/statistics'), headers, { forbidden: 'immich_admin' }),
    dlStats(w, headers),
  ]);
  return {
    photos: s.photos, videos: s.videos, usage: s.usage,
    users: (s.usageByUser || [])
      .map((u) => ({ name: u.userName, photos: u.photos, videos: u.videos, usage: u.usage, quota: u.quotaSizeInBytes ?? null }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 8),
    downloads,
  };
}

// Totaux seulement : les noms et e-mails des visiteurs ne quittent pas dl-stats.
async function dlStats(w, headers) {
  try {
    const [top, v] = await Promise.all([
      getJson(join(w.url, '/dl-stats/api/top'), headers),
      getJson(join(w.url, '/dl-stats/api/visitors'), headers),
    ]);
    if (typeof top.total !== 'number') return null;
    return { total: top.total, images: top.images ?? null, visitors: Array.isArray(v.visitors) ? v.visitors.length : null };
  } catch {
    return null; // pas de dl-stats devant cet Immich
  }
}

module.exports = {
  immich: { fields: ['url', 'apiKey'], cacheMs: 60_000, fetch: immich },
};
