// Intégrations : récupère et normalise les données des services. Un fichier par service (ou par
// famille : arr.js pour Sonarr et Radarr, dns.js pour Pi-hole et AdGuard Home), qui exporte
// { type: définition }. Une définition contient :
//   fields        champs du widget : url, apiKey, username, password, location, repo, entities, slug
//   fetch(w)      récupère les données du widget w (une promesse)
//   cacheMs       durée pendant laquelle les données sont partagées entre visiteurs (défaut : CACHE_MS) ;
//                 une fonction du widget permet de l'adapter (GitHub : plus long sans jeton)
//   sections      blocs au choix (ex. Pulse, GitHub)
//   userRequired  nom d'utilisateur obligatoire (vérifié par server.js)
//   thumbnail     images servies par /api/widgets/:id/thumbnail/:clé (voir server.js)
//   generatedKey  jeton créé par le serveur, pour un service qui contacte le dashboard (agent)
//   receive(w, b) reçoit les données envoyées par ce service (POST /api/agent/:id)
//   reset()       vide les sessions et caches propres au service quand la config change

const { request } = require('./lib');

// Ordre d'affichage dans le formulaire de l'interface : voir public/widgets/.
const FILES = ['weather', 'github', 'immich', 'goaccess', 'alwaysdata', 'npm', 'homeassistant', 'frigate', 'dns', 'proxmox', 'pulse',
  'glances', 'agent', 'uptimekuma', 'jellyfin', 'plex', 'qbittorrent', 'arr'];
const INTEGRATIONS = Object.assign({}, ...FILES.map((f) => require(`./${f}`)));

// Petit cache pour ne pas solliciter les services à chaque visiteur.
const cache = new Map();
const CACHE_MS = 4000;
// Âge maximal d'une réponse précédente servie pendant un rechargement (voir fetchWidget).
const STALE_MS = 5 * 60_000;
const STALE_WAIT_MS = 300;

async function fetchWidget(w) {
  const integration = INTEGRATIONS[w.type];
  if (!integration) throw new Error(`Type inconnu : ${w.type}`);
  const ttl = (typeof integration.cacheMs === 'function' ? integration.cacheMs(w) : integration.cacheMs) || CACHE_MS;
  let entry = cache.get(w.id);
  if (!entry || Date.now() - entry.t >= ttl) {
    // La dernière réponse réussie reste disponible pendant que la nouvelle se charge.
    const last = entry?.value ? { t: entry.t, value: entry.value } : entry?.last;
    const current = { t: Date.now(), promise: integration.fetch(w), last };
    current.promise.then((value) => { current.value = value; current.last = null; },
      () => { if (cache.get(w.id) === current) cache.delete(w.id); });
    cache.set(w.id, current);
    entry = current;
  }
  // Un service lent (sites Alwaysdata testés un par un, Immich…) ne fait pas attendre l'écran :
  // au-delà de STALE_WAIT_MS, la réponse précédente, si elle est récente, est renvoyée.
  if (!entry.value && entry.last && Date.now() - entry.last.t < Math.max(ttl * 5, STALE_MS)) return orStale(entry.promise, entry.last.value);
  return entry.promise;
}

// La promesse si elle aboutit dans STALE_WAIT_MS, sinon `stale` (elle continue en arrière-plan).
function orStale(promise, stale) {
  let timer;
  const wait = new Promise((resolve) => { timer = setTimeout(() => resolve(stale), STALE_WAIT_MS); });
  return Promise.race([promise, wait]).finally(() => clearTimeout(timer));
}

// À appeler quand la config change (URL ou identifiants modifiés).
function resetIntegrations() {
  cache.clear();
  for (const integration of Object.values(INTEGRATIONS)) integration.reset?.();
}

module.exports = { INTEGRATIONS, fetchWidget, resetIntegrations, request, orStale };
