// Loki : volume de logs et erreurs récentes des dernières 24 h. URL de Loki (port 3100), ou celle de
// Grafana avec le chemin de sa source de données (/api/datasources/proxy/uid/…) et un jeton de compte
// de service. Identifiant et mot de passe si un reverse proxy protège Loki. `query` : sélecteur LogQL
// facultatif, ex. {job="varlogs"} ; sans lui, tous les logs (premier label connu parmi PREFERRED).
// Les lignes de log ne sont montrées qu'aux admins : elles peuvent contenir n'importe quoi.

const { request, fail, join, basicAuth } = require('./lib');

const PREFERRED = ['job', 'service_name', 'container', 'container_name', 'app', 'filename'];
const ERRORS = '|~ `(?i)\\b(error|fatal|panic|critical)\\b`';
const MAX_RECENT = 8;
const MAX_SOURCES = 5;
const MAX_LINE = 300;

function headers(w) {
  if (w.apiKey) return { Accept: 'application/json', Authorization: `Bearer ${w.apiKey}` };
  return { Accept: 'application/json', ...(w.username ? basicAuth(w.username, w.password || '') : {}) };
}

async function lokiGet(w, path, params = {}) {
  const q = new URLSearchParams(params);
  const r = await request(join(w.url, `/loki/api/v1/${path}${q.size ? `?${q}` : ''}`), { headers: headers(w) });
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée');
  if (r.status === 404) throw fail('loki_api', 'API de Loki introuvable : vérifie l\'adresse (port 3100)');
  if (r.status === 400) {
    const detail = String(r.json?.message || r.text || '').slice(0, 200);
    throw fail('loki_query', `Requête LogQL refusée : ${detail}`, { detail });
  }
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json?.status !== 'success') throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json.data;
}

const firstValue = (data) => Number(data?.result?.[0]?.value?.[1]) || 0;

async function loki(w) {
  const now = Date.now();
  const nanos = (ms) => `${ms}000000`;
  const range = { start: nanos(now - 86400_000), end: nanos(now) };
  let selector = w.query;
  let group = 'job';
  if (!selector) {
    const labels = await lokiGet(w, 'labels', range);
    group = PREFERRED.find((l) => labels?.includes(l)) || labels?.find((l) => !l.startsWith('__'));
    // Aucun log reçu depuis 24 h : Loki répond, il n'y a simplement rien à compter.
    if (!group) return { lines: 0, bytes: 0, errors: 0, sources: [], recent: [] };
    selector = `{${group}=~".+"}`;
  }
  const [lines, bytes, errors, sources, recent] = await Promise.all([
    lokiGet(w, 'query', { query: `sum(count_over_time(${selector}[24h]))` }),
    lokiGet(w, 'query', { query: `sum(bytes_over_time(${selector}[24h]))` }),
    lokiGet(w, 'query', { query: `sum(count_over_time(${selector} ${ERRORS} [24h]))` }),
    lokiGet(w, 'query', { query: `topk(${MAX_SOURCES}, sum by (${group}) (count_over_time(${selector}[24h])))` }),
    lokiGet(w, 'query_range', { query: `${selector} ${ERRORS}`, limit: MAX_RECENT, direction: 'backward', ...range }),
  ]);
  return {
    lines: firstValue(lines),
    bytes: firstValue(bytes),
    errors: firstValue(errors),
    sources: (sources?.result || []).map((s) => ({ name: s.metric?.[group] || '', count: Number(s.value?.[1]) || 0 }))
      .filter((s) => s.name).sort((a, b) => b.count - a.count),
    recent: (recent?.result || []).flatMap((s) => (s.values || []).map(([ns, line]) => ({
      time: new Date(Number(ns) / 1e6).toISOString(),
      // Sans les couleurs de terminal, fréquentes dans les logs de conteneurs.
      line: String(line).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, MAX_LINE),
      source: s.stream?.[group] || '',
    }))).sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, MAX_RECENT),
  };
}

module.exports = {
  loki: {
    fields: ['url', 'username', 'password', 'apiKey', 'query'], cacheMs: 60_000, fetch: loki,
    publicData: ({ recent, ...d }) => ({ ...d, recent: [], hidden: recent.length > 0 }),
  },
};
