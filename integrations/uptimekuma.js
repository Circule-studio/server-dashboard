// Uptime Kuma : sondes d'une page de statut. Les pages de statut sont publiques : pas de clé,
// seulement l'URL d'Uptime Kuma et le nom (slug) de la page, voir server.js pour l'adresse collée.

const { request, fail, join } = require('./lib');

// Codes d'état d'Uptime Kuma : 0 hors ligne, 1 en ligne, 2 en attente, 3 maintenance.
const STATES = ['down', 'up', 'pending', 'maintenance'];
const ORDER = { down: 0, pending: 1, maintenance: 2, up: 3, unknown: 4 }; // les sondes en panne d'abord

async function kumaGet(w, path) {
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json' } });
  if (r.status === 404) throw fail('kuma_not_found', `Page de statut introuvable : ${w.slug}`, { slug: w.slug });
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

async function uptimekuma(w) {
  const slug = encodeURIComponent(w.slug);
  const [page, beats] = await Promise.all([
    kumaGet(w, `/api/status-page/${slug}`),
    kumaGet(w, `/api/status-page/heartbeat/${slug}`),
  ]);
  // Une page inexistante peut aussi répondre 200 sans config, selon la version.
  if (!page.config) throw fail('kuma_not_found', `Page de statut introuvable : ${w.slug}`, { slug: w.slug });
  const seen = new Set();
  const monitors = (page.publicGroupList || []).flatMap((g) => g.monitorList || [])
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .map((m) => {
      const list = beats.heartbeatList?.[m.id] || [];
      const last = list[list.length - 1];
      const uptime = beats.uptimeList?.[`${m.id}_24`];
      return {
        name: m.name,
        status: last ? STATES[last.status] || 'unknown' : 'unknown',
        ping: typeof last?.ping === 'number' ? last.ping : null,
        uptime: typeof uptime === 'number' ? uptime : null,
        message: last?.status === 0 ? (last.msg || '') : '',
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  const count = (s) => monitors.filter((m) => m.status === s).length;
  const uptimes = monitors.map((m) => m.uptime).filter((u) => u != null);
  return {
    title: page.config.title || w.slug,
    up: count('up'),
    down: count('down'),
    uptime: uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null,
    monitors: monitors.slice(0, 25),
    total: monitors.length,
  };
}

// Alertes : une sonde hors ligne (« en attente » et maintenance ne sont pas des pannes).
const alerts = (d, w) => d.monitors.map((m) => ({ id: `${w.id}:${m.name}`, name: m.name, url: w.url, online: m.status !== 'down' }));

module.exports = {
  uptimekuma: { fields: ['url', 'slug'], fetch: uptimekuma, alerts },
};
