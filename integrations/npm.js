// Nginx Proxy Manager.
// `username` : e-mail du compte, `password` : son mot de passe. POST /api/tokens donne un jeton
// (valable 1 jour par défaut) : gardé et réutilisé, renouvelé avant expiration ou après un refus.

const { request, fail, join, sessionCache } = require('./lib');

const NPM_SOON_DAYS = 14; // un certificat qui expire avant est mis en évidence
const NPM_ALERT_DAYS = 7; // … et déclenche une alerte (case « M'alerter »)

async function npmLogin(w) {
  const body = JSON.stringify({ identity: w.username || '', secret: w.password || '' });
  const r = await request(join(w.url, '/api/tokens'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  // Gardé au moins 10 min : avec des horloges décalées, un jeton neuf semblerait déjà expiré et on se
  // reconnecterait à chaque requête. S'il est vraiment expiré, NPM répond 401 et npmGet se reconnecte.
  if (r.status === 200 && r.json?.token) {
    return { token: r.json.token, expires: Math.max(Date.parse(r.json.expires) || 0, Date.now() + 10 * 60_000) };
  }
  if (r.status >= 400 && r.status < 500) throw fail('npm_credentials', 'Identifiants Nginx Proxy Manager refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

const npmSessions = sessionCache(npmLogin); // { token, expires }

async function npmGet(w, path, retry = true) {
  let session = await npmSessions.get(w);
  // Renouvelé 5 min avant l'expiration.
  if (session.expires - Date.now() < 5 * 60_000) {
    npmSessions.drop(w);
    session = await npmSessions.get(w);
  }
  const { token } = session;
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retry) { // jeton révoqué (mot de passe changé, redémarrage…)
    npmSessions.drop(w);
    return npmGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('npm_credentials', 'Identifiants Nginx Proxy Manager refusés');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (!Array.isArray(r.json)) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// Dates de NPM : « 2026-12-01 10:00:00 » en UTC, sans fuseau.
const npmDate = (v) => (typeof v === 'string' ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`) : NaN);

async function nginxProxyManager(w) {
  // En parallèle : la connexion est partagée (sessionCache), une seule a lieu.
  const [hosts, certificates] = await Promise.all([
    npmGet(w, '/api/nginx/proxy-hosts'),
    npmGet(w, '/api/nginx/certificates'),
  ]);
  const now = Date.now();
  const certs = certificates.map((c) => {
    const expires = npmDate(c.expires_on);
    return {
      name: c.nice_name || c.domain_names?.[0] || `#${c.id}`,
      domains: (c.domain_names || []).length,
      provider: c.provider === 'letsencrypt' ? 'letsencrypt' : 'other',
      expires: Number.isNaN(expires) ? null : new Date(expires).toISOString(),
      expired: expires <= now,
      // Jours entamés : 4,2 jours restants s'affichent « dans 5 jours ».
      days: Number.isNaN(expires) ? null : Math.ceil((expires - now) / 864e5),
    };
  }).sort((a, b) => (a.expires ?? '9').localeCompare(b.expires ?? '9'));
  const enabled = hosts.filter((x) => x.enabled === true || x.enabled === 1).length;
  return {
    hosts: { enabled, disabled: hosts.length - enabled },
    soonDays: NPM_SOON_DAYS,
    expiring: certs.filter((c) => c.expired || (c.days != null && c.days <= NPM_SOON_DAYS)).length,
    certificates: certs.slice(0, 8),
    certificateCount: certs.length,
  };
}

// Alertes : un certificat expiré ou qui expire dans NPM_ALERT_DAYS jours, puis renouvelé.
const alerts = (d, w) => d.certificates.map((c) => ({
  id: `${w.id}:cert:${c.name}`, name: c.name, url: w.url, problem: 'cert',
  online: !c.expired && (c.days == null || c.days > NPM_ALERT_DAYS), value: c.expired ? 0 : c.days,
}));

module.exports = {
  npm: { fields: ['url', 'username', 'password'], userRequired: true, cacheMs: 60_000, fetch: nginxProxyManager, alerts, reset: () => npmSessions.clear() },
};
