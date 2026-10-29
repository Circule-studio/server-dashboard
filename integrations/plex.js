// Plex.

const { join, pad, getJson } = require('./lib');

async function plex(w) {
  const h = { 'X-Plex-Token': w.apiKey };
  const [status, libs] = await Promise.all([
    getJson(join(w.url, '/status/sessions'), h),
    getJson(join(w.url, '/library/sections'), h),
  ]);
  const items = status.MediaContainer?.Metadata || [];
  const dirs = libs.MediaContainer?.Directory || [];
  return {
    stats: [
      { key: 'libraries', value: dirs.length },
      { key: 'streams', value: items.length },
    ],
    sessions: items.map((m) => {
      const episode = m.type === 'episode';
      return {
        user: m.User?.title,
        device: m.Player?.title,
        title: episode ? `${m.grandparentTitle} — S${pad(m.parentIndex)}E${pad(m.index)}` : m.title,
        subtitle: episode ? m.title : (m.year ? String(m.year) : ''),
        progress: m.duration ? (m.viewOffset || 0) / m.duration : 0,
        paused: m.Player?.state === 'paused',
      };
    }),
  };
}

module.exports = {
  plex: { fields: ['url', 'apiKey'], fetch: plex },
};
