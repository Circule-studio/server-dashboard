# Server Dashboard

Dashboard web auto-hébergé, dans l'esprit de Homarr, pour accéder aux services de ton serveur depuis une seule page.

**🌐 Site du projet : [circule-studio.github.io/server-dashboard](https://circule-studio.github.io/server-dashboard/)**

![Vue d'ensemble du dashboard : stats du serveur, widgets Jellyfin, qBittorrent, Sonarr, Radarr, tuiles d'applications et conteneurs Docker](docs/screenshots/dashboard.png)

<details>
<summary>Version mobile</summary>

<img src="docs/screenshots/mobile.png" alt="Le dashboard sur un écran de téléphone" width="320">

</details>

*Captures réalisées avec les faux services de `npm run mocks`.*

- **Tuiles d'applications** classées par catégories, avec icônes ([dashboardicons.com](https://dashboardicons.com)) et indicateur en ligne / hors ligne. Le ping est fait côté serveur, donc il marche aussi pour les services du réseau local.
- **Stats du serveur** : CPU, mémoire, disque, uptime (mises à jour toutes les 5 s).
- **Panneau Docker** : liste des conteneurs et leur état, avec démarrage, arrêt et redémarrage.
- **Widgets d'intégration** :
  - **Jellyfin / Plex** : lectures en cours (utilisateur, progression, pause) et taille de la bibliothèque.
  - **qBittorrent** : débits, torrents actifs, progression et temps restant.
  - **Sonarr / Radarr** : épisodes et films à venir, file de téléchargement.
- **Mode édition** protégé par mot de passe : ajouter, modifier ou supprimer des apps et des catégories, réordonner par glisser-déposer.

Stack : Node.js + Express côté serveur, HTML/CSS/JS sans étape de build côté client. La config est stockée dans `data/config.json`.

## Déploiement sur le serveur (Docker)

1. Copie le dossier sur le serveur (`git clone`, `scp`…).
2. Crée le fichier `.env` à partir du modèle et mets-y un vrai mot de passe :

   ```bash
   cp .env.example .env
   ```

   `.env` est ignoré par Git : ne mets jamais de mot de passe directement dans `docker-compose.yml`.
3. Lance :

   ```bash
   docker compose up -d --build
   ```

4. Ouvre `http://IP-DU-SERVEUR:7575` et clique sur **Connexion**, puis **Éditer** pour ajouter tes services.

Pour mettre à jour après une modification du code : `docker compose up -d --build`. La config reste dans `./data`.

## Développement en local

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:7575 (mot de passe par défaut : `admin`).

Pour travailler sur les widgets sans avoir les vrais services, lance de faux Jellyfin, qBittorrent, Sonarr et Radarr dans un second terminal :

```bash
npm run mocks
```

Les URL et clés de test à saisir sont en tête de [dev/mocks.js](dev/mocks.js).

## Widgets : où trouver les identifiants

| Service | Champs | Où les trouver |
|---|---|---|
| Jellyfin | URL + clé API | Tableau de bord > Clés API > « + » |
| Plex | URL + token | Valeur `X-Plex-Token` ([doc Plex](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) |
| qBittorrent | URL + utilisateur / mot de passe de la WebUI | Options > Interface web |
| Sonarr / Radarr | URL + clé API | Settings > General > API Key |

Les URL doivent être joignables **depuis le serveur du dashboard** (par exemple `http://jellyfin:8096` si les deux sont dans le même réseau Docker). Les clés et mots de passe restent sur le serveur : ils ne sont jamais renvoyés au navigateur.

## Contribuer

Les contributions sont bienvenues, en particulier sur l'interface. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `7575` | Port HTTP |
| `ADMIN_PASSWORD` | `admin` | Mot de passe du mode édition |
| `DATA_DIR` | `./data` | Dossier de la config et du secret de session |
| `SERVER_NAME` | nom de la machine | Nom affiché à côté du titre (utile en Docker) |
| `DISK_PATH` | `/` (`C:\` sous Windows) | Chemin dont on affiche l'occupation disque |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket de l'API Docker |
| `SESSION_SECRET` | généré dans `data/.secret` | Clé de signature des cookies de session |

## Sécurité

- Monter `/var/run/docker.sock` donne au conteneur un accès équivalent à root sur l'hôte. Les actions Docker exigent d'être connecté, mais n'expose pas le dashboard directement sur Internet : place-le derrière un reverse proxy en HTTPS (Nginx Proxy Manager, Caddy, Traefik) ou derrière un VPN (WireGuard, Tailscale).
- Pour un panneau Docker en lecture seule, utilise un proxy de socket comme `tecnativa/docker-socket-proxy` et pointe `DOCKER_SOCKET` dessus (ou retire simplement le volume).

## API

| Méthode | Route | Auth |
|---|---|---|
| GET | `/api/config` | – |
| PUT | `/api/config` | ✔ |
| GET | `/api/status` | – |
| GET | `/api/system` | – |
| GET | `/api/widgets/:id` | – |
| GET | `/api/docker/containers` | – |
| POST | `/api/docker/containers/:id/(start\|stop\|restart)` | ✔ |
| POST | `/api/login`, `/api/logout` · GET `/api/me` | – |
