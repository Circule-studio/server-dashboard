// Watchtower : résultat de son dernier passage. API HTTP à activer (WATCHTOWER_HTTP_API_METRICS=true
// et WATCHTOWER_HTTP_API_TOKEN, port 8080) ; `apiKey` = ce jeton. Ses métriques ne donnent ni le nom
// des conteneurs ni la date du passage : `seenAt` est le moment où le dashboard a vu le compteur de
// passages changer, gardé en mémoire. « updated » compte les conteneurs à mettre à jour en mode
// surveillance (WATCHTOWER_MONITOR_ONLY), et ceux mis à jour sinon.

const { request, fail, join, parseMetrics, sumMetric } = require('./lib');

const seen = new Map(); // id du widget -> { scans, at }

async function watchtower(w) {
  const r = await request(join(w.url, '/v1/metrics'), { headers: { Authorization: `Bearer ${w.apiKey}` } });
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Jeton refusé');
  if (r.status === 404) throw fail('watchtower_api', 'API de Watchtower introuvable : active WATCHTOWER_HTTP_API_METRICS');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (!/^watchtower_/m.test(r.text)) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL : port 8080)');
  const m = parseMetrics(r.text);
  const scans = sumMetric(m, 'watchtower_scans');
  const last = seen.get(w.id);
  if (!last || last.scans !== scans) seen.set(w.id, { scans, at: last ? Date.now() : null });
  return {
    scanned: sumMetric(m, 'watchtower_containers_scanned'),
    updated: sumMetric(m, 'watchtower_containers_updated'),
    failed: sumMetric(m, 'watchtower_containers_failed'),
    scans,
    skipped: sumMetric(m, 'watchtower_scans_skipped'),
    seenAt: seen.get(w.id).at ? new Date(seen.get(w.id).at).toISOString() : null,
  };
}

module.exports = {
  watchtower: { fields: ['url', 'apiKey'], cacheMs: 15_000, fetch: watchtower },
};
