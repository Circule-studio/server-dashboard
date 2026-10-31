// Traefik : routeurs, services et middlewares (HTTP, TCP, UDP) avec ceux en erreur, entrypoints et
// version, via l'API de Traefik (`api.dashboard`, port 8080 par défaut). Identifiant et mot de passe
// facultatifs : un middleware basicAuth devant l'API. Les certificats ne sont pas exposés par l'API.

const { request, fail, join, basicAuth } = require('./lib');

const MAX_PROBLEMS = 10;
const MAX_ALERT_ROUTERS = 100;

async function traefikGet(w, path) {
  const headers = { Accept: 'application/json', ...(w.username || w.password ? basicAuth(w.username, w.password) : {}) };
  const r = await request(join(w.url, path), { headers });
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie l\'identifiant et le mot de passe)');
  if (r.status === 404) throw fail('traefik_api', 'API de Traefik introuvable : active api.dashboard (ou api.insecure)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// { total, warnings, errors } -> nombres (0 si absent).
const counts = (c) => ({ total: c?.total || 0, warnings: c?.warnings || 0, errors: c?.errors || 0 });

async function traefik(w) {
  const [overview, version, routers, entrypoints] = await Promise.all([
    traefikGet(w, '/api/overview'),
    traefikGet(w, '/api/version').catch(() => null),
    traefikGet(w, '/api/http/routers?per_page=500').catch(() => []),
    traefikGet(w, '/api/entrypoints').catch(() => []),
  ]);
  if (!overview.http) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  const sum = (key) => ['http', 'tcp', 'udp'].reduce((acc, p) => {
    const c = counts(overview[p]?.[key]);
    return { total: acc.total + c.total, warnings: acc.warnings + c.warnings, errors: acc.errors + c.errors };
  }, { total: 0, warnings: 0, errors: 0 });
  const list = Array.isArray(routers) ? routers : [];
  // Routeurs HTTP en erreur ou en avertissement, les erreurs d'abord.
  const problems = list.filter((r) => r.status && r.status !== 'enabled')
    .map((r) => ({ name: r.name, status: r.status === 'disabled' ? 'error' : 'warning', error: (r.error || []).join(' · ').slice(0, 200), rule: r.rule || '' }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'error' ? -1 : 1));
  return {
    version: version?.Version || null,
    routers: sum('routers'),
    services: sum('services'),
    middlewares: sum('middlewares'),
    entrypoints: (Array.isArray(entrypoints) ? entrypoints : []).map((e) => ({ name: e.name, address: e.address || '' })),
    problems: problems.slice(0, MAX_PROBLEMS),
    // Pour « M'alerter » : chaque routeur HTTP et son état.
    routerStates: list.slice(0, MAX_ALERT_ROUTERS).map((r) => ({ name: r.name, ok: r.status === 'enabled' })),
  };
}

// Alertes : un routeur HTTP qui passe en erreur (ou désactivé), puis revient.
const alerts = (d, w) => d.routerStates.map((r) => ({ id: `${w.id}:${r.name}`, name: `${w.name} · ${r.name}`, url: w.url, online: r.ok }));

module.exports = {
  traefik: { fields: ['url', 'username', 'password'], fetch: traefik, alerts, cacheMs: 30_000 },
};
