// Wazuh : agents (actifs, déconnectés, jamais connectés) et version du manager via son API (port 55000,
// identifiant et mot de passe d'un compte de l'API, idéalement en lecture seule). Facultatif : les alertes
// des dernières 24 h par gravité, lues dans l'indexer (OpenSearch, port 9200, index wazuh-alerts-*) :
// `indexerUrl` + `apiKey` = « utilisateur:mot de passe » de l'indexer. Certificats auto-signés acceptés.

const { request, fail, join, sessionCache, basicAuth } = require('./lib');

const LEVEL_HIGH = 12;   // gravité « critique » (Wazuh : 12 à 15)
const LEVEL_MEDIUM = 7;  // « élevée » (7 à 11)
const MAX_RECENT = 6;
const MAX_ALERT_AGENTS = 200;

async function wazuhLogin(w) {
  const r = await request(join(w.url, '/security/user/authenticate'), {
    method: 'POST', headers: { Accept: 'application/json', ...basicAuth(w.username, w.password) },
  });
  if (r.status === 200 && r.json?.data?.token) return { token: r.json.data.token, expires: Date.now() + 12 * 60_000 }; // jeton de 15 min
  if (r.status === 401 || r.status === 403) throw fail('wazuh_credentials', 'Identifiants de l\'API Wazuh refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL : API du manager, port 55000)');
}

const sessions = sessionCache(wazuhLogin);

async function wazuhGet(w, path, retry = true) {
  let session = await sessions.get(w);
  if (session.expires < Date.now()) {
    sessions.drop(w);
    session = await sessions.get(w);
  }
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` } });
  if (r.status === 401 && retry) {
    sessions.drop(w);
    return wazuhGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('wazuh_credentials', 'Identifiants de l\'API Wazuh refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (!r.json?.data) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL : API du manager, port 55000)');
  return r.json.data;
}

// Alertes des 24 h dans l'indexer : nombre par gravité et dernières alertes importantes.
async function indexerAlerts(w) {
  const sep = w.apiKey.indexOf(':');
  const auth = sep > 0 ? basicAuth(w.apiKey.slice(0, sep), w.apiKey.slice(sep + 1)) : {};
  const body = JSON.stringify({
    size: 0,
    query: { range: { timestamp: { gte: 'now-24h' } } },
    aggs: {
      levels: { range: { field: 'rule.level', ranges: [{ key: 'low', to: LEVEL_MEDIUM }, { key: 'medium', from: LEVEL_MEDIUM, to: LEVEL_HIGH }, { key: 'high', from: LEVEL_HIGH }] } },
      important: {
        filter: { range: { 'rule.level': { gte: LEVEL_MEDIUM } } },
        aggs: { last: { top_hits: { size: MAX_RECENT, sort: [{ timestamp: { order: 'desc' } }], _source: ['timestamp', 'rule.level', 'rule.description', 'agent.name'] } } },
      },
    },
  });
  const r = await request(join(w.indexerUrl, '/wazuh-alerts-*/_search'), {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body), ...auth },
  });
  if (r.status === 401 || r.status === 403) throw fail('wazuh_indexer_credentials', 'Identifiants de l\'indexer Wazuh refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  const aggs = r.json?.aggregations;
  if (!aggs) throw fail('unexpected_response', 'Réponse inattendue de l\'indexer (vérifie l\'URL : port 9200)');
  const by = Object.fromEntries((aggs.levels.buckets || []).map((b) => [b.key, b.doc_count]));
  return {
    low: by.low || 0, medium: by.medium || 0, high: by.high || 0,
    recent: (aggs.important.last.hits.hits || []).map(({ _source: s }) => ({
      level: s.rule?.level ?? 0, description: String(s.rule?.description || '').slice(0, 200), agent: s.agent?.name || '', time: s.timestamp,
    })),
  };
}

async function wazuh(w) {
  const [summary, info, agents, disconnected] = await Promise.all([
    wazuhGet(w, '/agents/summary/status'),
    wazuhGet(w, '/manager/info').catch(() => null),
    wazuhGet(w, `/agents?select=name,status&limit=${MAX_ALERT_AGENTS}`).catch(() => null),
    wazuhGet(w, '/agents?status=disconnected&select=name,lastKeepAlive&limit=5&sort=-lastKeepAlive').catch(() => null),
  ]);
  const c = summary.connection || summary; // Wazuh 4.4+ : connection ; avant : à la racine
  let alerts = null;
  let alertsError = null;
  if (w.indexerUrl && w.apiKey) {
    try {
      alerts = await indexerAlerts(w);
    } catch (e) {
      alertsError = e.key || 'http'; // les agents restent affichés
    }
  }
  return {
    version: info?.affected_items?.[0]?.version || null,
    agents: { active: c.active || 0, disconnected: c.disconnected || 0, never: c.never_connected || 0, pending: c.pending || 0, total: c.total || 0 },
    disconnected: (disconnected?.affected_items || []).map((a) => ({ name: a.name, id: a.id, lastKeepAlive: a.lastKeepAlive || null })),
    // Pour « M'alerter » : l'agent 000 (le manager lui-même) et les agents jamais connectés sont ignorés.
    agentStates: (agents?.affected_items || []).filter((a) => a.id !== '000' && a.status !== 'never_connected')
      .map((a) => ({ id: a.id, name: a.name, ok: a.status === 'active' || a.status === 'pending' })),
    alerts,
    alertsError,
  };
}

// Alertes : un agent qui se déconnecte, et une alerte critique (niveau 12+) dans les 24 h.
const alerts = (d, w) => [
  ...d.agentStates.map((a) => ({ id: `${w.id}:agent:${a.id}`, name: `${w.name} · ${a.name}`, url: w.url, online: a.ok })),
  ...(d.alerts ? [{ id: `${w.id}:critical`, name: w.name, url: w.url, problem: 'security', online: d.alerts.high === 0, value: d.alerts.high }] : []),
];

module.exports = {
  wazuh: {
    fields: ['url', 'username', 'password', 'indexerUrl', 'apiKey'], userRequired: true, cacheMs: 30_000,
    fetch: wazuh, alerts, reset: () => sessions.clear(),
  },
};
