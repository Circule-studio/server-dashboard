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
const FILES = ['weather', 'github', 'immich', 'npm', 'homeassistant', 'frigate', 'dns', 'proxmox', 'pulse',
  'glances', 'agent', 'uptimekuma', 'jellyfin', 'plex', 'qbittorrent', 'arr'];
const INTEGRATIONS = Object.assign({}, ...FILES.map((f) => require(`./${f}`)));

// Petit cache pour ne pas solliciter les services à chaque visiteur.
const cache = new Map();
const CACHE_MS = 4000;

async function fetchWidget(w) {
  const integration = INTEGRATIONS[w.type];
  if (!integration) throw new Error(`Type inconnu : ${w.type}`);
  const hit = cache.get(w.id);
  const ttl = typeof integration.cacheMs === 'function' ? integration.cacheMs(w) : integration.cacheMs;
  if (hit && Date.now() - hit.t < (ttl || CACHE_MS)) return hit.promise;
  const promise = integration.fetch(w);
  cache.set(w.id, { t: Date.now(), promise });
  promise.catch(() => cache.delete(w.id));
  return promise;
}

// À appeler quand la config change (URL ou identifiants modifiés).
function resetIntegrations() {
  cache.clear();
  for (const integration of Object.values(INTEGRATIONS)) integration.reset?.();
}

module.exports = { INTEGRATIONS, fetchWidget, resetIntegrations, request };
