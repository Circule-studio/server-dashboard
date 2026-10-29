# Agent Server Dashboard

Petit script Node.js, sans dépendance, à lancer sur une machine que tu veux voir sur le dashboard : PC, Raspberry Pi, NAS ou 2e serveur. Il envoie le CPU, la mémoire, les disques, la température et l'uptime toutes les 30 secondes.

**C'est la machine qui contacte le dashboard.** Il n'y a aucun port à ouvrir chez elle, et ça marche aussi derrière un NAT, chez quelqu'un d'autre par exemple. Si la machine n'envoie plus rien, le widget affiche « Plus de nouvelles depuis… » avec ses dernières valeurs.

Pour une machine du réseau local où tu peux installer [Glances](https://github.com/nicolargo/glances), le widget **Glances** fait la même chose sans agent.

## Installation

1. Dans le dashboard : **Éditer > + Widget > Agent**, puis enregistre.
2. Rouvre le widget. Le formulaire affiche la commande à lancer sur la machine, avec son identifiant et son jeton. Elle télécharge le script depuis ton dashboard.
3. Lance la commande sur la machine (Node.js 18 ou plus récent). Le widget se remplit au premier envoi.

Variables facultatives :

| Variable | Défaut | Rôle |
|---|---|---|
| `AGENT_INTERVAL` | `30` | Secondes entre deux envois (5 au minimum) |
| `AGENT_DISKS` | `/` (`C:\` sous Windows) | Disques à surveiller, séparés par des virgules : `/,/mnt/data` |

`node server-dashboard-agent.js --once` fait un seul envoi puis s'arrête : pratique pour tester.

## Lancement automatique

### Linux (systemd)

Copie le script dans `/opt/server-dashboard-agent/`, puis crée `/etc/systemd/system/server-dashboard-agent.service`. Remplace les trois valeurs par celles de la commande donnée par le dashboard :

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

## Sécurité

- Le jeton n'autorise qu'une chose : envoyer les relevés de **ce** widget. Il ne donne aucun accès au dashboard.
- Il est créé par le dashboard, et seul un admin connecté peut le voir. Pour le changer, supprime le widget et crée-en un autre.
- Les relevés reçus sont vérifiés et bornés par le dashboard avant d'être affichés.
