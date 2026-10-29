// Jellyfin.

const { join, pad, getJson } = require('./lib');

async function jellyfin(w) {
  const h = { 'X-Emby-Token': w.apiKey };
  const [sessions, counts] = await Promise.all([
    getJson(join(w.url, '/Sessions?activeWithinSeconds=600'), h),
    getJson(join(w.url, '/Items/Counts'), h),
  ]);
  return {
    stats: [
      { key: 'movies', value: counts.MovieCount },
      { key: 'series', value: counts.SeriesCount },
      { key: 'episodes', value: counts.EpisodeCount },
    ],
    sessions: sessions.filter((s) => s.NowPlayingItem).map((s) => {
      const it = s.NowPlayingItem;
      const episode = it.Type === 'Episode';
      return {
        user: s.UserName,
        device: s.DeviceName,
        title: episode ? `${it.SeriesName} — S${pad(it.ParentIndexNumber)}E${pad(it.IndexNumber)}` : it.Name,
        subtitle: episode ? it.Name : (it.ProductionYear ? String(it.ProductionYear) : ''),
        progress: it.RunTimeTicks ? (s.PlayState?.PositionTicks || 0) / it.RunTimeTicks : 0,
        paused: !!s.PlayState?.IsPaused,
      };
    }),
  };
}

module.exports = {
  jellyfin: { fields: ['url', 'apiKey'], fetch: jellyfin },
};
