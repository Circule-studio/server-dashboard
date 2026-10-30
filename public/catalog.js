// Catalogue d'applications connues : dans « Nouvelle application », en choisir une remplit
// le nom, l'icône, la description et l'URL avec son port par défaut. Il ne reste qu'à taper l'adresse IP.
//
// Pour en ajouter une, un objet par application :
//   name   nom affiché (et cherché)
//   icon   nom d'icône de https://dashboardicons.com
//   port   port par défaut ; scheme : 'https' si l'application n'écoute qu'en HTTPS (défaut 'http')
//   path   chemin à ajouter à l'URL, si l'interface n'est pas à la racine (ex. '/admin')
//   fr, en courte description dans chaque langue
const APP_CATALOG = [
  // Médias
  { name: 'Jellyfin', icon: 'jellyfin', port: 8096, fr: 'Films et séries', en: 'Movies and TV shows' },
  { name: 'Plex', icon: 'plex', port: 32400, path: '/web', fr: 'Films et séries', en: 'Movies and TV shows' },
  { name: 'Emby', icon: 'emby', port: 8096, fr: 'Films et séries', en: 'Movies and TV shows' },
  { name: 'Navidrome', icon: 'navidrome', port: 4533, fr: 'Musique', en: 'Music' },
  { name: 'Audiobookshelf', icon: 'audiobookshelf', port: 13378, fr: 'Livres audio et podcasts', en: 'Audiobooks and podcasts' },
  { name: 'Kavita', icon: 'kavita', port: 5000, fr: 'Livres, BD et mangas', en: 'Books, comics and manga' },
  { name: 'Calibre-Web', icon: 'calibre-web', port: 8083, fr: 'Bibliothèque de livres numériques', en: 'E-book library' },
  { name: 'Tautulli', icon: 'tautulli', port: 8181, fr: 'Statistiques Plex', en: 'Plex statistics' },
  // Téléchargements et *arr
  { name: 'Sonarr', icon: 'sonarr', port: 8989, fr: 'Séries', en: 'TV shows' },
  { name: 'Radarr', icon: 'radarr', port: 7878, fr: 'Films', en: 'Movies' },
  { name: 'Lidarr', icon: 'lidarr', port: 8686, fr: 'Musique', en: 'Music' },
  { name: 'Readarr', icon: 'readarr', port: 8787, fr: 'Livres', en: 'Books' },
  { name: 'Prowlarr', icon: 'prowlarr', port: 9696, fr: 'Indexeurs', en: 'Indexers' },
  { name: 'Bazarr', icon: 'bazarr', port: 6767, fr: 'Sous-titres', en: 'Subtitles' },
  { name: 'Jellyseerr', icon: 'jellyseerr', port: 5055, fr: 'Demandes de films et séries', en: 'Movie and TV requests' },
  { name: 'Overseerr', icon: 'overseerr', port: 5055, fr: 'Demandes de films et séries', en: 'Movie and TV requests' },
  { name: 'qBittorrent', icon: 'qbittorrent', port: 8080, fr: 'Torrents', en: 'Torrents' },
  { name: 'Transmission', icon: 'transmission', port: 9091, fr: 'Torrents', en: 'Torrents' },
  { name: 'SABnzbd', icon: 'sabnzbd', port: 8080, fr: 'Usenet', en: 'Usenet' },
  { name: 'Tdarr', icon: 'tdarr', port: 8265, fr: 'Conversion vidéo', en: 'Video transcoding' },
  // Photos et fichiers
  { name: 'Immich', icon: 'immich', port: 2283, fr: 'Photos et vidéos', en: 'Photos and videos' },
  { name: 'PhotoPrism', icon: 'photoprism', port: 2342, fr: 'Photos', en: 'Photos' },
  { name: 'Nextcloud', icon: 'nextcloud', port: 443, scheme: 'https', fr: 'Fichiers, agenda et contacts', en: 'Files, calendar and contacts' },
  { name: 'Syncthing', icon: 'syncthing', port: 8384, fr: 'Synchronisation de fichiers', en: 'File sync' },
  { name: 'File Browser', icon: 'filebrowser', port: 8080, fr: 'Gestionnaire de fichiers', en: 'File manager' },
  { name: 'Paperless-ngx', icon: 'paperless-ngx', port: 8000, fr: 'Documents numérisés', en: 'Scanned documents' },
  { name: 'Stirling-PDF', icon: 'stirling-pdf', port: 8080, fr: 'Outils PDF', en: 'PDF tools' },
  // Maison
  { name: 'Home Assistant', icon: 'home-assistant', port: 8123, fr: 'Domotique', en: 'Home automation' },
  { name: 'Frigate', icon: 'frigate', port: 5000, fr: 'Caméras et détection', en: 'Cameras and detection' },
  { name: 'Zigbee2MQTT', icon: 'zigbee2mqtt', port: 8080, fr: 'Appareils Zigbee', en: 'Zigbee devices' },
  { name: 'Node-RED', icon: 'node-red', port: 1880, fr: 'Automatisations', en: 'Automations' },
  { name: 'Homebridge', icon: 'homebridge', port: 8581, fr: 'Passerelle HomeKit', en: 'HomeKit bridge' },
  { name: 'Mealie', icon: 'mealie', port: 9000, fr: 'Recettes', en: 'Recipes' },
  { name: 'Actual Budget', icon: 'actual-budget', port: 5006, fr: 'Budget', en: 'Budgeting' },
  // Réseau et sécurité
  { name: 'Pi-hole', icon: 'pi-hole', port: 80, path: '/admin', fr: 'Bloqueur de publicités DNS', en: 'DNS ad blocker' },
  { name: 'AdGuard Home', icon: 'adguard-home', port: 80, fr: 'Bloqueur de publicités DNS', en: 'DNS ad blocker' },
  { name: 'Nginx Proxy Manager', icon: 'nginx-proxy-manager', port: 81, fr: 'Proxy et certificats HTTPS', en: 'Proxy and HTTPS certificates' },
  { name: 'Vaultwarden', icon: 'vaultwarden', port: 443, scheme: 'https', fr: 'Mots de passe', en: 'Passwords' },
  // Serveur et supervision
  { name: 'Proxmox VE', icon: 'proxmox', port: 8006, scheme: 'https', fr: 'Virtualisation', en: 'Virtualization' },
  { name: 'Proxmox Backup Server', icon: 'proxmox', port: 8007, scheme: 'https', fr: 'Sauvegardes Proxmox', en: 'Proxmox backups' },
  { name: 'Pulse', icon: 'pulse', port: 7655, fr: 'Supervision Proxmox et Docker', en: 'Proxmox and Docker monitoring' },
  { name: 'Portainer', icon: 'portainer', port: 9443, scheme: 'https', fr: 'Conteneurs Docker', en: 'Docker containers' },
  { name: 'Dockge', icon: 'dockge', port: 5001, fr: 'Piles Docker Compose', en: 'Docker Compose stacks' },
  { name: 'Uptime Kuma', icon: 'uptime-kuma', port: 3001, fr: 'Surveillance de disponibilité', en: 'Uptime monitoring' },
  { name: 'Grafana', icon: 'grafana', port: 3000, fr: 'Tableaux de bord et graphiques', en: 'Dashboards and graphs' },
  { name: 'Glances', icon: 'glances', port: 61208, fr: 'Ressources du système', en: 'System resources' },
  { name: 'Netdata', icon: 'netdata', port: 19999, fr: 'Supervision en temps réel', en: 'Real-time monitoring' },
  { name: 'Duplicati', icon: 'duplicati', port: 8200, fr: 'Sauvegardes', en: 'Backups' },
  { name: 'Scrutiny', icon: 'scrutiny', port: 8080, fr: 'Santé des disques (SMART)', en: 'Disk health (SMART)' },
  // Développement
  { name: 'Gitea', icon: 'gitea', port: 3000, fr: 'Dépôts Git', en: 'Git repositories' },
  { name: 'code-server', icon: 'code-server', port: 8443, fr: 'VS Code dans le navigateur', en: 'VS Code in the browser' },
  { name: 'n8n', icon: 'n8n', port: 5678, fr: 'Automatisations', en: 'Automations' },
];
