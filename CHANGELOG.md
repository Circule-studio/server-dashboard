# Changelog

Toutes les évolutions notables du projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Corrigé
- Un onglet resté ouvert (ou un autre appareil) ne peut plus écraser la config sans prévenir : l’enregistrement est refusé avec un message, et l’interface propose de recharger la version actuelle (#25).

### Sécurité
- body-parser 2.4.0 (dépendance d’Express). Dependabot vérifie chaque jour toutes les dépendances, indirectes comprises, vers `preprod`.

## [0.4.0] - 2026-10-26

### Ajouté
- Widget **Pulse** : santé (OK / attention / critique / éteints), alertes actives et nœuds / VM / LXC, en blocs au choix. Plusieurs widgets Pulse peuvent être placés librement. Faux Pulse dans `npm run mocks`.

### Corrigé
- Les noms d’utilisateur des widgets (Proxmox, qBittorrent) pouvaient être effacés si la page avait été ouverte avant la connexion puis enregistrée.

### Modifié
- Express 5 et actions/checkout v7 (Dependabot).

## [0.3.0] - 2026-10-25

### Ajouté
- **Plusieurs disques** : bouton « Disques » en mode édition, détection automatique des disques (Windows et Linux), une carte par disque avec un nom personnalisable.
- CI : construction et test de l'image Docker.

### Corrigé
- En local (`npm start` / `npm run dev`), le fichier `.env` est maintenant lu : le mot de passe qu'il contient est bien pris en compte (avant, seul Docker le lisait).

## [0.2.0] - 2026-10-25

### Ajouté
- Widget **Proxmox VE** : CPU, RAM et disque de l’hôte, état des VM et conteneurs LXC, stockages (jeton d’API en lecture seule). Faux Proxmox dans `npm run mocks`.

### Modifié
- `install.sh` : sortie plus propre dans un LXC minimal (pas d’avertissements de locale ni de notice npm).

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

[Non publié]: https://github.com/Circule-studio/server-dashboard/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Circule-studio/server-dashboard/releases/tag/v0.1.0
