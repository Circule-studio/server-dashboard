// Bloqueurs DNS : Pi-hole v6 et AdGuard Home.
// Format commun : protection (enabled / disabled / failed / unknown), minuteur (s),
// requêtes, bloquées, pourcentage, plus quelques compteurs propres au service.

const { request, fail, join, getJson, sessionCache, basicAuth } = require('./lib');

// Pi-hole limite le nombre de sessions ouvertes (« API seats ») : on garde la
// session tant qu'elle est valide au lieu de se reconnecter à chaque appel.
// La promesse de connexion est mémorisée : deux appels simultanés ne consomment qu'une session.

async function piholeLogin(w) {
  const body = JSON.stringify({ password: w.password || '' });
  const r = await request(join(w.url, '/api/auth'), {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  const session = r.json?.session;
  if (r.status === 200 && session?.valid) return session.sid || '';
  // 2FA activée : seul un mot de passe d'application évite le code TOTP.
  if (r.status === 400 && /2FA|totp/i.test(r.json?.error?.message || '')) throw fail('pihole_totp', 'Pi-hole demande un code 2FA');
  if (r.status === 429) throw fail('pihole_seats', 'Pi-hole refuse une nouvelle session (trop de sessions ou de tentatives)');
  if (r.status === 401 || session) throw fail('pihole_password', 'Mot de passe Pi-hole refusé');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
}

const piholeSessions = sessionCache(piholeLogin); // SID ('' : Pi-hole sans mot de passe)

async function piholeGet(w, path, retry = true) {
  const sid = await piholeSessions.get(w);
  const r = await request(join(w.url, path), { headers: { Accept: 'application/json', ...(sid ? { 'X-FTL-SID': sid } : {}) } });
  if (r.status === 401 && retry) { // session expirée (30 min sans activité par défaut)
    piholeSessions.drop(w);
    return piholeGet(w, path, false);
  }
  if (r.status === 401 || r.status === 403) throw fail('pihole_password', 'Mot de passe Pi-hole refusé');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

async function pihole(w) {
  // Séquentiel : la première requête ouvre la session, la seconde la réutilise.
  const s = await piholeGet(w, '/api/stats/summary');
  const b = await piholeGet(w, '/api/dns/blocking');
  return {
    protection: b.blocking || 'unknown',
    timer: b.timer ?? null,
    queries: s.queries?.total ?? 0,
    blocked: s.queries?.blocked ?? 0,
    percent: s.queries?.percent_blocked ?? 0,
    extra: [
      { key: 'blocklist', value: s.gravity?.domains_being_blocked ?? null },
      { key: 'clients', value: s.clients?.active ?? null },
    ],
  };
}

// AdGuard Home : authentification HTTP Basic (facultative si l'interface n'a pas de mot de passe).
async function adguard(w) {
  const h = w.username || w.password
    ? basicAuth(w.username, w.password)
    : {};
  const [stats, status] = await Promise.all([
    getJson(join(w.url, '/control/stats'), h),
    getJson(join(w.url, '/control/status'), h),
  ]).catch((e) => {
    // Pas de clé API ici : un refus vient de l'utilisateur ou du mot de passe.
    throw e.key === 'auth_refused' ? fail('adguard_credentials', 'Identifiants AdGuard Home refusés') : e;
  });
  const queries = stats.num_dns_queries || 0;
  // Bloquées = filtres + navigation sécurisée + contrôle parental (comme le tableau de bord d'AdGuard).
  const blocked = (stats.num_blocked_filtering || 0) + (stats.num_replaced_safebrowsing || 0) + (stats.num_replaced_parental || 0);
  return {
    protection: !status.running ? 'failed' : status.protection_enabled ? 'enabled' : 'disabled',
    timer: status.protection_disabled_duration ? status.protection_disabled_duration / 1000 : null,
    queries,
    blocked,
    percent: queries ? (blocked / queries) * 100 : 0,
    extra: [{ key: 'avgTime', value: stats.avg_processing_time ?? null }],
  };
}

// Ferme les sessions Pi-hole devenues inutiles pour libérer leurs places (sans attendre la réponse).
function closePiholeSessions() {
  for (const { url, promise } of piholeSessions.clear()) {
    promise.then((s) => s && request(join(url, '/api/auth'), { method: 'DELETE', headers: { 'X-FTL-SID': s }, discardBody: true }))
      .catch(() => {});
  }
}

module.exports = {
  pihole: { fields: ['url', 'password'], fetch: pihole, reset: closePiholeSessions },
  adguard: { fields: ['url', 'username', 'password'], fetch: adguard },
};
