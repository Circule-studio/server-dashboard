// Outils communs aux intégrations : requêtes HTTP bornées, erreurs traduisibles, sessions.

const http = require('http');
const https = require('https');

// Les erreurs réseau de Node (ECONNREFUSED…) n'ont souvent pas de message lisible.
const NETWORK_ERRORS = {
  ECONNREFUSED: 'Service injoignable (connexion refusée)',
  ENOTFOUND: 'Adresse introuvable',
  EHOSTUNREACH: 'Hôte injoignable',
  ECONNRESET: 'Connexion interrompue',
  ETIMEDOUT: 'Délai dépassé',
};

// Erreur avec un code traduisible par l'interface (`key`, voir err.* dans public/i18n.js).
function fail(key, message, params) {
  return Object.assign(new Error(message), { key, params });
}

const NETWORK_KEYS = {
  ECONNREFUSED: 'unreachable', ENOTFOUND: 'host_not_found', EHOSTUNREACH: 'host_unreachable',
  ECONNRESET: 'connection_reset', ETIMEDOUT: 'timeout',
};

function networkError(e) {
  return fail(NETWORK_KEYS[e.code], NETWORK_ERRORS[e.code] || e.message || e.code || 'Erreur réseau');
}

// Taille maximale d'une réponse : au-delà, la requête est abandonnée. Sans limite, une URL
// pointant par erreur vers un gros fichier faisait planter tout le dashboard (chaîne trop longue).
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// `discardBody` : on ne lit que le code HTTP (utile pour un simple ping).
// `raw` : corps renvoyé tel quel dans `body` (Buffer), pour une image.
// `verifyTls` : vérifier le certificat. Désactivé par défaut : les services du réseau local ont
// souvent un certificat auto-signé. À activer pour un service public qui reçoit un secret.
// `timeout` : inactivité maximale ; `deadline` : durée totale maximale. Le `timeout` de Node
// ne mesure que l'inactivité : un service qui envoie un octet de temps en temps le contournait.
function request(url, {
  method = 'GET', headers = {}, body, timeout = 8000, deadline = 20_000, maxBytes = MAX_RESPONSE_BYTES, discardBody = false,
  verifyTls = false, raw = false,
} = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(fail('invalid_url', 'URL invalide', { url })); }
    let done = false;
    let timer;
    // Une seule issue par requête, même si plusieurs événements arrivent ensuite (erreur après abandon…).
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout, rejectUnauthorized: verifyTls }, (res) => {
      res.on('error', (e) => finish(reject, networkError(e)));
      if (discardBody) {
        res.destroy();
        return finish(resolve, { status: res.statusCode, headers: res.headers });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (d) => {
        size += d.length;
        if (size > maxBytes) {
          finish(reject, fail('response_too_large', 'Réponse trop volumineuse (vérifie l\'URL)', { max: Math.round(maxBytes / 1048576) }));
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        if (done) return;
        if (raw) return finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        // Décodage en une fois : un caractère accentué coupé entre deux morceaux reste correct.
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* pas du JSON */ }
        finish(resolve, { status: res.statusCode, headers: res.headers, text, json });
      });
    });
    const expire = () => req.destroy(Object.assign(new Error('Délai dépassé'), { code: 'ETIMEDOUT' }));
    timer = setTimeout(expire, deadline);
    req.on('timeout', expire);
    req.on('error', (e) => finish(reject, networkError(e)));
    if (body) req.write(body);
    req.end();
  });
}

const join = (base, p) => base.replace(/\/+$/, '') + p;
const pad = (n) => String(n ?? 0).padStart(2, '0');

// `forbidden` : code d'erreur plus précis pour un 403 (clé valide mais droits insuffisants).
async function getJson(url, headers = {}, { forbidden } = {}) {
  const r = await request(url, { headers: { Accept: 'application/json', ...headers } });
  if (r.status === 403 && forbidden) throw fail(forbidden, 'Droits insuffisants');
  if (r.status === 401 || r.status === 403) throw fail('auth_refused', 'Authentification refusée (vérifie la clé API)');
  if (r.status >= 400) throw fail('http', `HTTP ${r.status}`, { status: r.status });
  if (r.json === null) throw fail('unexpected_response', 'Réponse inattendue (vérifie l\'URL)');
  return r.json;
}

// ---------- Sessions des services à connexion (qBittorrent, Pi-hole, NPM, Frigate) ----------
// Une session par widget, ouverte une seule fois même pour des appels simultanés (l'entrée est créée
// avant tout await). Un échec de connexion est retenu LOGIN_RETRY_MS : sans ça, chaque rafraîchissement
// de chaque visiteur retentait la connexion, au risque de verrouiller le compte ou de bloquer l'IP.
const LOGIN_RETRY_MS = 60_000;

function sessionCache(login) {
  const entries = new Map(); // id du widget -> { url, promise, failed, error }
  return {
    get(w) {
      let e = entries.get(w.id);
      if (e?.failed && Date.now() - e.failed < LOGIN_RETRY_MS) return Promise.reject(e.error);
      if (!e || e.failed) {
        e = { url: w.url, promise: login(w) };
        e.promise.catch((error) => Object.assign(e, { failed: Date.now(), error }));
        entries.set(w.id, e);
      }
      return e.promise;
    },
    // Session refusée ou expirée : la prochaine get() se reconnecte (sans attendre LOGIN_RETRY_MS).
    drop(w) { entries.delete(w.id); },
    // Vide le cache et renvoie les sessions qu'il contenait (pour les fermer proprement).
    clear() {
      const old = [...entries.values()];
      entries.clear();
      return old;
    },
  };
}

// En-tête d'authentification HTTP Basic (AdGuard Home, Glances…).
const basicAuth = (user, password) => ({ Authorization: `Basic ${Buffer.from(`${user || ''}:${password || ''}`).toString('base64')}` });

// ---------- Alertes (case « M'alerter », voir integrations/index.js) ----------
// Disques : alerte au-delà de DISK_ALERT (part utilisée), « de nouveau sous » en dessous.
const DISK_ALERT = 0.9;
const diskAlerts = (w, disks, label = (d) => d.mount) => disks.filter((d) => d.size > 0).map((d) => ({
  id: `${w.id}:disk:${label(d)}`, name: `${w.name} · ${label(d)}`, url: w.url, problem: 'disk',
  online: d.used / d.size < DISK_ALERT, value: Math.round((d.used / d.size) * 100),
}));

module.exports = { request, fail, join, pad, getJson, sessionCache, basicAuth, diskAlerts };
