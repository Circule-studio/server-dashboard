// Faux services pour développer les widgets sans installer Jellyfin & co.
// Lancer : npm run mocks, puis ajouter les widgets dans le dashboard avec :
//   Jellyfin     http://localhost:18096  clé API  jf-key
//   Plex         http://localhost:13240  token    plex-token
//   qBittorrent  http://localhost:18080  admin / secret
//   Sonarr       http://localhost:18989  clé API  sonarr-key
//   Radarr       http://localhost:17878  clé API  radarr-key
//   Lidarr       http://localhost:18686  clé API  lidarr-key ; Readarr http://localhost:18787  readarr-key
//   Prowlarr     http://localhost:19696  clé API  prowlarr-key ; Bazarr http://localhost:16767  bazarr-key
//   Proxmox VE   http://localhost:18006  jeton    root@pam!dashboard / pve-secret
//   Pulse        http://localhost:17655  jeton    pulse-token
//   Calendrier   adresse  http://localhost:18091/agenda.ics ; /prive.ics avec agenda / agenda-pass
//   Flux RSS     http://localhost:18090/rss.xml et /atom.xml (/pas-un-flux : erreur)
//   GoAccess     http://localhost:17890  rapport JSON, sans clé
//   API perso    http://localhost:18092/stats (sans clé) ou /prive (en-tête « X-Api-Key: custom-key », ou api / api-pass)
//   Alwaysdata   URL de l'API http://localhost:17443/v1  jeton  alwaysdata-token (compte facultatif)
//   Uptime Kuma  http://localhost:13001  page de statut  maison (ou coller http://localhost:13001/status/maison)
//   Glances      http://localhost:61208  sans mot de passe (PC, API v4)
//                http://localhost:61209  glances / glances-pass (Raspberry Pi, API v3)
//   Météo        http://localhost:18765  lieu     Nantes, Paris (ou des coordonnées « 47.21, -1.55 »)
//   Immich       http://localhost:12283  clé API  immich-key (immich-user-key : compte non admin, refusé)
//   Pi-hole v6   http://localhost:10080  mot de passe  pihole-pass (2fa-pass : 2FA activée, refusé sans code)
//   AdGuard Home http://localhost:13000  admin / adguard-pass
//   Frigate      http://localhost:15000  sans authentification (port 5000 du vrai)
//                http://localhost:18971  viewer / frigate-pass (port 8971 du vrai, avec connexion)
//   Home Assist. http://localhost:18123  jeton    ha-token ; entités : voir HA_STATES plus bas
//   NPM          http://localhost:10081  admin@example.com / npm-pass (Nginx Proxy Manager)
//   GitHub       http://localhost:14000  dépôt  circule-studio/server-dashboard (jeton facultatif)
//                demo/private (jeton gh-token obligatoire), demo/tags-only, demo/empty, demo/rate-limited, demo/secondary
// Faux Docker : lancer le dashboard avec la variable DOCKER_SOCKET affichée au démarrage.
// Un fichier par service dans dev/mocks/ : pour en ajouter un, crée-le et ajoute-le à la liste.
const SERVICES = ['jellyfin', 'plex', 'qbittorrent', 'arr', 'proxmox', 'pulse', 'glances', 'uptimekuma', 'weather', 'immich', 'pihole', 'adguard',
  'frigate', 'homeassistant', 'npm', 'github', 'goaccess', 'alwaysdata', 'rss', 'ical', 'customapi'];
for (const name of SERVICES) require(`./mocks/${name}`);
const { DOCKER_SOCKET } = require('./mocks/docker');

console.log('mocks prêts');
console.log(`Faux Docker : DOCKER_SOCKET=${DOCKER_SOCKET}`);
