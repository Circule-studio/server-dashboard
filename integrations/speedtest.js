// Speedtest Tracker (https://github.com/alexjustesen/speedtest-tracker) : dernier test et moyenne
// sur 7 jours. Avec un jeton : API v1 (download_bits en bit/s, ou download en octets/s). Sans jeton :
// ancienne API publique /api/speedtest/latest (débits déjà en Mbit/s).

const { join, getJson } = require('./lib');

const WEEK_MS = 7 * 864e5;

// Débits en Mbit/s, ping en ms.
const v1 = (r) => ({
  down: r.download_bits != null ? r.download_bits / 1e6 : (r.download ?? 0) * 8 / 1e6,
  up: r.upload_bits != null ? r.upload_bits / 1e6 : (r.upload ?? 0) * 8 / 1e6,
  ping: r.ping ?? null,
  date: r.created_at || r.updated_at || null,
  ok: !r.status || r.status === 'completed',
});

async function speedtest(w) {
  if (!w.apiKey) {
    const r = (await getJson(join(w.url, '/api/speedtest/latest'))).data || {};
    return { latest: { down: Number(r.download) || 0, up: Number(r.upload) || 0, ping: r.ping ?? null, date: r.created_at || null }, history: [], average: null };
  }
  const h = { Authorization: `Bearer ${w.apiKey}` };
  const [latest, list] = await Promise.all([
    getJson(join(w.url, '/api/v1/results/latest'), h),
    // Historique facultatif : un serveur qui ne le fournit pas n'empêche pas le widget.
    getJson(join(w.url, '/api/v1/results?per_page=100'), h).catch(() => ({ data: [] })),
  ]);
  const week = (list.data || []).map(v1).filter((r) => r.ok && r.date && Date.now() - new Date(r.date) < WEEK_MS)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const avg = (k) => week.reduce((n, r) => n + r[k], 0) / week.length;
  return {
    latest: v1(latest.data || {}),
    history: week.slice(-12).map((r) => ({ down: r.down, date: r.date })),
    average: week.length ? { down: avg('down'), up: avg('up'), count: week.length } : null,
  };
}

module.exports = {
  speedtest: { fields: ['url', 'apiKey'], cacheMs: 5 * 60_000, fetch: speedtest },
};
