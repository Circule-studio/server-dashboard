# Guide

🇬🇧 [English version](GUIDE.md) · [Retour au README](../README.fr.md) · [Widgets](WIDGETS.fr.md)

- [Fonctionnalités en détail](#fonctionnalités-en-détail)
- [Installation en détail](#installation-en-détail)
- [Plusieurs disques](#plusieurs-disques)
- [Variables d'environnement](#variables-denvironnement)
- [Sécurité](#sécurité)
- [API](#api)
- [Développement en local](#développement-en-local)

## Fonctionnalités en détail

- **Tuiles d'applications** classées par catégories, avec icônes ([dashboardicons.com](https://dashboardicons.com)) et indicateur en ligne / hors ligne. Le ping est fait côté serveur, donc il marche aussi pour les services du réseau local. Une tuile peut être **liée à sa VM, son LXC Proxmox ou son conteneur Docker** pour afficher leur CPU et leur RAM.
- **Stats du serveur** : CPU, mémoire, disque, uptime (mises à jour toutes les 5 s).
- **Courbes d'historique** : clique sur une carte de stats, ou sur le bouton courbe d'un widget Agent ou d'un nœud, d'une VM, d'un LXC ou d'un stockage Proxmox. CPU, mémoire, disque et réseau sur 24 h ou 7 jours, avec la valeur sous le pointeur. Un trou veut dire que la machine ou le dashboard était arrêté. Quand un disque se remplit régulièrement depuis au moins 2 jours, une estimation donne les jours restants à ce rythme. L'historique du dashboard et des agents est gardé dans `data/history.json` (quelques centaines de Ko, sans base de données) ; Proxmox garde le sien, lu à la demande. Les machines suivies avec Glances n'ont pas encore d'historique.
- **Panneau Docker** : liste des conteneurs et leur état, avec démarrage, arrêt et redémarrage.
- **Recherche rapide** : commence à taper n’importe où. Elle filtre les tuiles et propose, au clavier, la tuile à ouvrir, l’adresse tapée (`nas.maison:8080`) ou une recherche web (DuckDuckGo, Google, Qwant…, ou une adresse personnalisée, réglable dans Affichage).
- **Mode édition** protégé par mot de passe : ajouter, modifier ou supprimer des apps et des catégories, réordonner par glisser-déposer.
- **Onglets** (ex. « Maison », « Serveur », « Médias ») pour répartir widgets et catégories sur plusieurs pages, avec un lien direct par onglet (`#medias`). La recherche parcourt tous les onglets.
- **Bouton ⟳ sur chaque widget**, pour l'admin connecté : les données à l'instant, sans cache. Un agent répond tout de suite, et le widget Mises à jour relance la recherche sur chaque machine.
- **Favoris** : une catégorie peut s’afficher en liens compacts (icône et nom, ou icônes seules), sans statut ni notification, pour la documentation, le routeur, etc. La recherche les trouve aussi.
- **Chiffres au choix et seuils de couleur** : dans le formulaire d’un widget à blocs de chiffres, coche ceux à afficher et choisis à partir de quelle valeur ils passent en orange ou en rouge.
- **Apparence** : couleur d’accent et image de fond (adresse ou fichier envoyé), avec le flou des cartes, dans Mode édition > Affichage.
- **Application installable** : « Ajouter à l’écran d’accueil » sur téléphone ouvre le dashboard en plein écran, avec son nom et son icône (HTTPS requis sur Android pour l’installation complète).
- **Widgets dans les catégories** : en mode édition, chaque widget a un menu pour le ranger dans une catégorie, sous ses tuiles. Il suit alors son onglet et se replie avec elle.
- **Catégories repliables** d’un clic sur leur titre (état mémorisé dans le navigateur, ou repliées par défaut), avec une icône facultative.
- **Mises à jour** : un badge « 7 mises à jour en attente », cliquable pour le détail par machine : paquets apt (dont ceux de sécurité) et images Docker dont le tag a changé. Pour le serveur du dashboard et chaque machine avec un agent. Affichage seulement, rien n’est installé. Les visiteurs non connectés ne voient que les nombres ; voir [agent/README.md](../agent/README.md#mises-à-jour-en-attente).
- **Agent** pour les machines derrière un NAT ou sans port ouvert : un petit script (Node.js, sans dépendance) envoie lui-même CPU, mémoire, disques et température au dashboard ; voir [agent/README.md](../agent/README.md).
- **Notifications** vers ntfy, Gotify, Discord ou un webhook quand une application tombe, puis quand elle revient : le serveur vérifie toutes les minutes, même dashboard fermé. Avec la case « M’alerter » d’un widget, aussi pour ce qu’il surveille : VM, conteneur ou nœud Proxmox arrêté, disque à plus de 90 % (Proxmox, Glances, Agent), machine Glances ou Agent hors ligne, certificat Nginx Proxy Manager qui expire dans 7 jours, sonde Uptime Kuma hors ligne, caméra Frigate coupée.
- **Sauvegarde** : export de la configuration en un fichier (avec ou sans les clés API), et import pour la restaurer ou la recopier sur une autre machine.

Stack : Node.js + Express côté serveur, HTML/CSS/JS sans étape de build côté client. La config est stockée dans `data/config.json`, et l'historique des courbes dans `data/history.json`.

## Installation en détail

### Docker

L'image est publiée sur `ghcr.io/circule-studio/server-dashboard`. `.env` ne doit jamais être publié : ne mets pas de mot de passe directement dans `compose.yaml`. La config reste dans `./data` lors des mises à jour.

**Depuis le code source** (développement) : clone le dépôt, remplace la ligne `image:` de `compose.yaml` par `build: .`, puis `docker compose up -d --build`.

### Sans Docker

Le script :
- installe Node.js 22 si besoin ;
- télécharge la dernière release dans `/opt/server-dashboard` ;
- crée un utilisateur système `server-dashboard` et un service systemd du même nom ;
- génère un mot de passe admin et l'affiche une seule fois.

| Quoi | Où |
|---|---|
| Réglages (mot de passe, port, `REQUIRE_LOGIN`…) | `/etc/server-dashboard/server-dashboard.env`, puis `sudo systemctl restart server-dashboard` |
| Config du dashboard (tuiles, widgets) | `/var/lib/server-dashboard/` |
| Logs | `journalctl -u server-dashboard -f` |

- **Mettre à jour** : relance la même commande. La config et les réglages sont conservés.
- **Choisir une version, un port ou un mot de passe** à la première installation : `… | sudo SD_VERSION=v0.1.0 SD_PORT=8080 SD_ADMIN_PASSWORD=… bash`
- **Désinstaller** : `… | sudo bash -s -- --uninstall` (ajoute `--purge` pour effacer aussi la config).
- **Panneau Docker** : si Docker est installé sur la machine, le service est ajouté au groupe `docker`. Sinon, le panneau est simplement masqué.

## Plusieurs disques

En mode édition, le bouton **Disques** liste les disques détectés sur la machine (`C:\`, `D:\`… sous Windows, les partitions réelles comme `/` ou `/mnt/data` sous Linux). Coche ceux à afficher et donne-leur un nom (« Films », « Sauvegardes »…) : chacun a sa carte dans les stats. Tu peux aussi saisir un chemin à la main (partage réseau monté, dossier…).

**Avec Docker**, le conteneur ne voit que ce qui est monté. `compose.yaml` monte déjà la racine de l'hôte en lecture seule (`/:/host:ro`) : les autres disques de l'hôte apparaissent sous `/host/…` (ex. `/host/mnt/data`). Un disque monté ailleurs peut être ajouté explicitement :

```yaml
    volumes:
      - /srv/films:/host/srv/films:ro
```

**Dans un conteneur LXC Proxmox**, le dashboard ne voit que le disque du conteneur : utilise plutôt le widget Proxmox VE pour les stockages de l'hôte.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `7575` | Port HTTP |
| `ADMIN_PASSWORD` | `admin` | Mot de passe du mode édition |
| `DATA_DIR` | `./data` | Dossier de la config et du secret de session |
| `SERVER_NAME` | nom de la machine | Nom affiché à côté du titre (utile en Docker) |
| `DISK_PATH` | `/` (`C:\` sous Windows) | Disque affiché par défaut, tant qu'aucun disque n'est choisi en mode édition |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket de l'API Docker |
| `REQUIRE_LOGIN` | `false` | `true` : tout le dashboard (lecture comprise) exige d’être connecté |
| `TRUST_PROXY` | – | Derrière un reverse proxy, mettre `1` pour que la limite de tentatives de connexion voie la vraie IP des visiteurs |
| `SESSION_SECRET` | généré dans `data/.secret` | Clé de signature des cookies de session |
| `NOTIFY_INTERVAL_MS` | `60000` | Intervalle de vérification des applications pour les notifications (en millisecondes) |
| `UPDATE_CHECK` | `true` | `false` : ne pas vérifier sur GitHub si une nouvelle version existe (la version installée reste affichée à l’admin) |

## Sécurité

- Les tentatives de connexion sont limitées à 10 par IP toutes les 15 minutes. Changer `ADMIN_PASSWORD` déconnecte toutes les sessions ouvertes.
- Par défaut, le dashboard est lisible sans connexion (seule la modification est protégée). Si tu l’exposes en dehors de ton réseau, mets `REQUIRE_LOGIN=true`.
- Monter `/var/run/docker.sock` donne au conteneur un accès équivalent à root sur l'hôte. Les actions Docker exigent d'être connecté, mais n'expose pas le dashboard directement sur Internet : place-le derrière un reverse proxy en HTTPS (Nginx Proxy Manager, Caddy, Traefik) ou derrière un VPN (WireGuard, Tailscale).
- Pour un panneau Docker en lecture seule, utilise un proxy de socket comme `tecnativa/docker-socket-proxy` et pointe `DOCKER_SOCKET` dessus (ou retire simplement le volume).
- Les clés API et les mots de passe restent sur le serveur : ils ne sont jamais envoyés au navigateur.

## API

Principales routes. « – » : publique, sauf si `REQUIRE_LOGIN=true`.

| Méthode | Route | Connexion |
|---|---|---|
| GET | `/api/config` | – |
| PUT | `/api/config` | ✔ |
| GET | `/api/config/export` | ✔ |
| GET | `/api/status` | – |
| GET | `/api/system` | – |
| GET | `/api/history?range=(day\|week)` | – |
| GET | `/api/widgets/:id/history?range=(day\|week)` | – |
| GET | `/api/links` | – |
| GET | `/api/widgets/:id` | – |
| POST | `/api/widgets/:id/refresh` | ✔ |
| GET | `/api/docker/containers` | – |
| POST | `/api/docker/containers/:id/(start\|stop\|restart)` | ✔ |
| GET | `/api/background` | – |
| POST | `/api/background` | ✔ |
| POST | `/api/notify/test` | ✔ |
| GET | `/api/version` | ✔ |
| POST | `/api/login`, `/api/logout` · GET `/api/me` | – |

## Développement en local

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:7575. Le mot de passe est celui de ton fichier `.env` s'il existe (attention aux majuscules), sinon `admin`.

Pour travailler sur les widgets sans avoir les vrais services, lance un faux service pour chaque widget (Jellyfin, Plex, Proxmox, Home Assistant, GitHub…) et un faux Docker dans un second terminal :

```bash
npm run mocks
```

Les URL et clés de test à saisir sont en tête de [dev/mocks.js](../dev/mocks.js).
