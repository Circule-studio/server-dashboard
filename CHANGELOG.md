# Changelog

Toutes les évolutions notables du projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.1.0] - 2026-10-25

Première version publique.

### Ajouté
- Tuiles d'applications par catégories, avec icônes et statut en ligne / hors ligne vérifié côté serveur.
- Stats du serveur : CPU, mémoire, disque, uptime.
- Panneau Docker : liste des conteneurs, démarrage / arrêt / redémarrage. Masqué automatiquement quand Docker n'est pas installé.
- Widgets Jellyfin, Plex, qBittorrent, Sonarr et Radarr. Les clés API restent côté serveur.
- Mode édition protégé par mot de passe : ajout et modification des apps, widgets et catégories, réorganisation par glisser-déposer (tuiles et widgets).
- Installation avec Docker (`docker compose`) ou **sans Docker** via `packaging/install.sh` : service systemd, mise à jour et désinstallation avec le même script.
- Option `REQUIRE_LOGIN` pour exiger une connexion même en lecture.
- Faux services (`npm run mocks`) pour développer sans rien installer.

### Sécurité
- Tentatives de connexion limitées à 10 par IP toutes les 15 minutes (`TRUST_PROXY` derrière un reverse proxy).
- Sessions invalidées à la déconnexion et au changement de mot de passe.
- Mot de passe admin lu depuis `.env` (Docker) ou `/etc/server-dashboard/server-dashboard.env` (systemd), jamais dans le dépôt.

[Non publié]: https://github.com/Circule-studio/server-dashboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Circule-studio/server-dashboard/releases/tag/v0.1.0
