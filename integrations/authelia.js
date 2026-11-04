// Authelia : connexions réussies, refusées et bloquées, double authentification et accès contrôlés.
// Tout vient de ses métriques Prometheus, à activer (telemetry.metrics.enabled, port 9959) ; sans
// authentification, donc à garder sur le réseau local. Ce sont des compteurs depuis le démarrage
// d'Authelia. Elle ne publie pas le nombre de sessions actives : le widget ne peut pas l'afficher.

const { request, fail, join, parseMetrics, sumMetric } = require('./lib');

async function authelia(w) {
  const r = await request(join(w.url, '/metrics'));
  if (r.status === 404 || (r.status < 400 && !/^(authelia_|go_goroutines)/m.test(r.text))) {
    throw fail('authelia_metrics', 'Métriques introuvables : active telemetry.metrics dans Authelia et utilise son port 9959');
  }
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  const m = parseMetrics(r.text);
  const yes = (l) => l.success === 'true';
  const banned = (l) => l.banned === 'true';
  const attempts = (name) => ({
    ok: sumMetric(m, name, yes),
    failed: sumMetric(m, name, (l) => !yes(l) && !banned(l)),
    banned: sumMetric(m, name, banned),
  });
  const authz = (test) => sumMetric(m, 'authelia_authz', (l) => test(Number(l.code)));
  const start = sumMetric(m, 'process_start_time_seconds');
  return {
    logins: attempts('authelia_authn'),
    secondFactor: attempts('authelia_authn_second_factor'),
    allowed: authz((code) => code < 400),
    denied: authz((code) => code === 401 || code === 403),
    since: start ? new Date(start * 1000).toISOString() : null,
  };
}

module.exports = {
  authelia: { fields: ['url'], cacheMs: 15_000, fetch: authelia },
};
