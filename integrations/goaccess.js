// GoAccess : visiteurs uniques et requêtes d'un site, lus dans un rapport JSON de GoAccess
// (goaccess … -o rapport.json). L'URL est celle du fichier JSON, sans clé. Un rapport limité au
// panneau des visiteurs (--ignore-panel pour les autres) suffit et ne contient aucune adresse IP.

const { request, fail } = require('./lib');

async function goaccess(w) {
  const r = await request(w.url, { headers: { Accept: 'application/json' } });
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  const g = r.json?.general;
  if (!g || typeof g.unique_visitors !== 'number') throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  // Jours au format AAAAMMJJ, du plus récent au plus ancien.
  const days = (r.json.visitors?.data || [])
    .filter((d) => /^\d{8}$/.test(d.data))
    .map((d) => ({ date: `${d.data.slice(0, 4)}-${d.data.slice(4, 6)}-${d.data.slice(6)}`, visitors: d.visitors?.count ?? 0, hits: d.hits?.count ?? 0 }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    visitors: g.unique_visitors, requests: g.total_requests ?? null, bandwidth: g.bandwidth ?? null,
    from: days.at(-1)?.date ?? null, to: days[0]?.date ?? null,
    days: days.slice(0, 7),
  };
}

module.exports = {
  goaccess: { fields: ['url'], cacheMs: 60_000, fetch: goaccess },
};
