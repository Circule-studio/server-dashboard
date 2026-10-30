// Famille *arr : Sonarr, Radarr, Lidarr, Readarr (à venir et file d'attente), Prowlarr et Bazarr.

const { join, pad, getJson } = require('./lib');

function queueSummary(q) {
  const records = q.records || [];
  return {
    total: q.totalRecords ?? records.length,
    items: records.slice(0, 5).map((r) => ({
      title: r.title,
      progress: r.size ? 1 - r.sizeleft / r.size : 0,
      status: r.trackedDownloadState || r.status,
      timeleft: r.timeleft || null,
    })),
  };
}

function dayRange(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return [start, new Date(start.getTime() + days * 864e5)];
}

async function sonarr(w) {
  const h = { 'X-Api-Key': w.apiKey };
  const [start, end] = dayRange(14);
  const [calendar, queue] = await Promise.all([
    getJson(join(w.url, `/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}&includeSeries=true`), h),
    getJson(join(w.url, '/api/v3/queue?pageSize=20'), h),
  ]);
  return {
    upcoming: calendar.slice(0, 10).map((e) => ({
      title: e.series?.title || null, // null : l'interface affiche « Série inconnue »
      subtitle: `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}${e.title ? ' · ' + e.title : ''}`,
      date: e.airDateUtc,
      hasFile: !!e.hasFile,
    })),
    queue: queueSummary(queue),
  };
}

async function radarr(w) {
  const h = { 'X-Api-Key': w.apiKey };
  const [start, end] = dayRange(30);
  const [calendar, queue] = await Promise.all([
    getJson(join(w.url, `/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}`), h),
    getJson(join(w.url, '/api/v3/queue?pageSize=20'), h),
  ]);
  const upcoming = calendar.map((m) => {
    // Un film a plusieurs dates de sortie : on garde la plus proche dans la période.
    const [kind, date] = [['cinema', m.inCinemas], ['digital', m.digitalRelease], ['physical', m.physicalRelease]]
      .filter(([, d]) => d && new Date(d) >= start && new Date(d) <= end)
      .sort((a, b) => new Date(a[1]) - new Date(b[1]))[0] || ['', m.inCinemas];
    return { title: m.title, year: m.year, release: kind, date, hasFile: !!m.hasFile };
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { upcoming: upcoming.slice(0, 10), queue: queueSummary(queue) };
}

// Lidarr (albums) et Readarr (livres) : même API v1, calendrier et file d'attente comme Sonarr.
function v1Calendar(include, by) {
  return async (w) => {
    const h = { 'X-Api-Key': w.apiKey };
    const [start, end] = dayRange(30);
    const [calendar, queue] = await Promise.all([
      getJson(join(w.url, `/api/v1/calendar?start=${start.toISOString()}&end=${end.toISOString()}&${include}=true`), h),
      getJson(join(w.url, '/api/v1/queue?pageSize=20'), h),
    ]);
    const upcoming = calendar.map((e) => ({
      title: e.title,
      subtitle: by(e) || '',
      date: e.releaseDate,
      hasFile: (e.statistics?.trackFileCount ?? e.statistics?.bookFileCount ?? 0) > 0,
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    return { upcoming: upcoming.slice(0, 10), queue: queueSummary(queue) };
  };
}

// Prowlarr : indexeurs actifs, en échec (désactivés temporairement) et statistiques.
async function prowlarr(w) {
  const h = { 'X-Api-Key': w.apiKey };
  const [indexers, status, stats] = await Promise.all([
    getJson(join(w.url, '/api/v1/indexer'), h),
    getJson(join(w.url, '/api/v1/indexerstatus'), h),
    getJson(join(w.url, '/api/v1/indexerstats'), h),
  ]);
  const enabled = indexers.filter((i) => i.enable);
  const failing = status.filter((s) => s.disabledTill && new Date(s.disabledTill) > Date.now())
    .map((s) => ({ name: indexers.find((i) => i.id === s.indexerId)?.name || `#${s.indexerId}`, until: s.disabledTill }));
  const sum = (k) => (stats.indexers || []).reduce((n, i) => n + (i[k] || 0), 0);
  return { enabled: enabled.length, failing, queries: sum('numberOfQueries'), grabs: sum('numberOfGrabs') };
}

// Bazarr : épisodes et films sans sous-titres, fournisseurs mis en pause (badges de l'interface).
async function bazarr(w) {
  const b = await getJson(join(w.url, '/api/badges'), { 'X-API-KEY': w.apiKey });
  return { episodes: b.episodes ?? 0, movies: b.movies ?? 0, providers: b.providers ?? 0 };
}

module.exports = {
  sonarr: { fields: ['url', 'apiKey'], fetch: sonarr },
  radarr: { fields: ['url', 'apiKey'], fetch: radarr },
  lidarr: { fields: ['url', 'apiKey'], fetch: v1Calendar('includeArtist', (e) => e.artist?.artistName) },
  readarr: { fields: ['url', 'apiKey'], fetch: v1Calendar('includeAuthor', (e) => e.author?.authorName) },
  prowlarr: { fields: ['url', 'apiKey'], fetch: prowlarr },
  bazarr: { fields: ['url', 'apiKey'], fetch: bazarr },
};
