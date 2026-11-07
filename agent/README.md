# Agent Server Dashboard

Petit script Node.js, sans dépendance, à lancer sur une machine que tu veux voir sur le dashboard : PC, Raspberry Pi, NAS ou 2e serveur. Il envoie le CPU, la mémoire, les disques, la température et l'uptime toutes les 30 secondes, et les mises à jour en attente (widget **Mises à jour**).

**C'est la machine qui contacte le dashboard.** Il n'y a aucun port à ouvrir chez elle, et ça marche aussi derrière un NAT, chez quelqu'un d'autre par exemple. L'agent garde pour cela une connexion ouverte vers le dashboard : le bouton ⟳ du widget y répond, et il envoie alors ses valeurs tout de suite. Si la machine n'envoie plus rien, le widget affiche « Plus de nouvelles depuis… » avec ses dernières valeurs.

Pour une machine du réseau local où tu peux installer [Glances](https://github.com/nicolargo/glances), le widget **Glances** fait la même chose sans agent.

## Installation

1. Dans le dashboard : **Éditer > + Widget > Agent**, donne-lui le nom de la machine, puis enregistre.
2. Rouvre le widget. Le formulaire affiche les commandes à lancer, avec son identifiant et son jeton.
3. Lance celle qui correspond :
   - **Sur la machine** (Debian, Ubuntu) : `curl … | sudo env … bash`.
   - **Dans un conteneur LXC, depuis le shell Proxmox** : `CT=100; curl … | pct exec $CT -- env … bash`, en remplaçant 100 par le numéro du conteneur.

Le widget se remplit dans les secondes qui suivent. La commande installe Node.js si besoin (dépôt NodeSource), le script dans `/opt/server-dashboard-agent` et un service systemd sans droits, qui démarre avec la machine. Le jeton va dans `/etc/server-dashboard-agent.env`, lisible par root seul.

**Relancer la même commande met à jour l'agent.** Pour désinstaller (Node.js reste) :

```bash
curl -fsSL http://IP-DU-DASHBOARD:7575/agent/install.sh | sudo bash -s -- --uninstall
```

Elle fait aussi deux choses pour le suivi des mises à jour, décrites plus bas : l'accès à Docker (`AGENT_DOCKER=0` dans la commande pour l'éviter) et le rafraîchissement des listes de paquets (`AGENT_APT_REFRESH=0`).

Sur une autre machine, ou pour essayer sans rien installer, le formulaire donne aussi la commande qui lance le script directement (Node.js 18.15 ou plus récent).

Variables facultatives :

| Variable | Défaut | Rôle |
|---|---|---|
| `AGENT_INTERVAL` | `30` | Secondes entre deux envois (5 au minimum) |
| `AGENT_DISKS` | `/` (`C:\` sous Windows) | Disques à surveiller, séparés par des virgules : `/,/mnt/data` |
| `AGENT_UPDATES` | `6` | Heures entre deux recherches de mises à jour, `0` pour désactiver |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Socket de l'API Docker, pour les images à mettre à jour |

`node server-dashboard-agent.js --once` fait un seul envoi puis s'arrête : pratique pour tester.

## Courbes d'historique

Le dashboard garde les relevés de l'agent et en tire des courbes sur 24 h et 7 jours (bouton courbe du widget). Les débits réseau viennent des compteurs de `/proc/net/dev`, sur Linux seulement : un agent installé avant la version 0.29.0 n'envoie pas ces compteurs, relance sa commande d'installation pour avoir la courbe du réseau.

## Lancement automatique à la main

### Linux (systemd)

Inutile si tu as utilisé la commande d'installation. Sinon, copie le script dans `/opt/server-dashboard-agent/`, puis crée `/etc/systemd/system/server-dashboard-agent.service`. Remplace les trois valeurs par celles de la commande donnée par le dashboard :

```ini
[Unit]
Description=Agent Server Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Environment=DASHBOARD_URL=http://192.168.1.10:7575
Environment=AGENT_ID=wid-…
Environment=AGENT_TOKEN=…
ExecStart=/usr/bin/node /opt/server-dashboard-agent/server-dashboard-agent.js
DynamicUser=true
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Puis : `sudo systemctl enable --now server-dashboard-agent`.

### Windows

Crée une tâche dans le Planificateur de tâches, déclenchée « Au démarrage ». Elle lance `node.exe` avec en argument le chemin du script. Définis les trois variables d'environnement pour l'utilisateur, par exemple avec `setx DASHBOARD_URL http://192.168.1.10:7575`.

## Mises à jour en attente

L'agent ne fait que compter : il n'installe rien et ne modifie rien.

- **Paquets apt** (Debian, Ubuntu, Proxmox) : le résultat de `apt-get -s dist-upgrade`, une simulation qui ne demande pas d'être root. Elle se base sur les listes de paquets de la machine, que l'agent ne rafraîchit pas. La commande d'installation active leur rafraîchissement quotidien (ça n'installe rien). Sans elle, si le widget les signale comme trop vieilles :
  ```bash
  echo 'APT::Periodic::Update-Package-Lists "1";' | sudo tee /etc/apt/apt.conf.d/20server-dashboard
  ```
- **Images Docker** : pour chaque conteneur lancé, l'agent compare l'image à celle que le registre donne pour le même tag, sans compte. Il voit donc que `nginx:latest` a changé, mais pas qu'une version `nginx:1.26` existe quand tu es en `1.25`. Une image privée, ou construite localement, est signalée comme non vérifiée. L'agent contacte les registres (Docker Hub, ghcr.io…) toutes les 6 heures, et leur envoie uniquement les noms des images.

  L'agent a besoin de lire le socket de Docker. La commande d'installation le permet si le groupe `docker` existe. Avec le service écrit à la main, ajoute dans `[Service]` :
  ```ini
  SupplementaryGroups=docker
  ```
  Le groupe `docker` donne un accès complet à Docker : sans ce suivi, évite-le (`AGENT_DOCKER=0`).

## Sécurité

- Le jeton n'autorise qu'une chose : envoyer les relevés de **ce** widget. Il ne donne aucun accès au dashboard.
- Il est créé par le dashboard, et seul un admin connecté peut le voir. Il apparaît dans la commande à lancer, et peut donc rester dans l'historique du terminal. En cas de doute, le bouton **Nouveau jeton** du formulaire en crée un autre (l'ancien cesse de marcher à l'enregistrement).
- Derrière un reverse proxy HTTPS, utilise l'adresse `https://` dans `DASHBOARD_URL`. La commande proposée reprend l'adresse de ton navigateur, et l'agent refuse de suivre une redirection.
- Les relevés reçus sont vérifiés et bornés par le dashboard avant d'être affichés.
