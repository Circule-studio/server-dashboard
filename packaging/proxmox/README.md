# Scripts Proxmox VE (community-scripts) : brouillon

Brouillon des deux scripts à proposer à [community-scripts](https://community-scripts.org/) pour installer Server Dashboard en une commande sur Proxmox VE (issue #15). Ils suivent la structure des scripts existants (Homepage, Homarr) :

| Fichier | Rôle |
|---|---|
| `ct/server-dashboard.sh` | Lancé sur l'hôte Proxmox : crée le conteneur LXC (Debian 13, 1 cœur, 512 Mo, 2 Go) et gère les mises à jour (`update_script`). |
| `install/server-dashboard-install.sh` | Lancé dans le conteneur : Node.js 22, dernière release, utilisateur système dédié, service systemd. |
| `test-install.sh` | Teste le script d'installation hors de Proxmox, avec les fonctions de community-scripts simulées. La CI le lance sur chaque push. |

Mêmes emplacements que [`packaging/install.sh`](../install.sh) : le code dans `/opt/server-dashboard`, les réglages dans `/etc/server-dashboard/server-dashboard.env` et les données dans `/var/lib/server-dashboard`. Une mise à jour remplace donc le code sans toucher à la config. Le mot de passe admin est généré à l'installation et enregistré dans `~/server-dashboard.creds`, dans le conteneur. Sans Docker dans le LXC, le panneau Docker se masque de lui-même.

## Où on en est

- [x] Script d'installation testé par la CI (Ubuntu, vrai systemd, fonctions simulées).
- [ ] `ct/server-dashboard.sh` testé sur un vrai Proxmox VE (création du LXC, puis mise à jour avec `update`).
- [ ] Fiche JSON de l'application, demandée par community-scripts pour son site (voir leurs règles de contribution).
- [ ] Projet éligible (6 mois d'existence, environ 1 000 étoiles), puis PR sur [DevScripts](https://github.com/community-scripts/DevScripts).

## Tester sur un Proxmox

Les scripts chargent leurs fonctions depuis `community-scripts/core`. Pour essayer avant toute PR, suis la procédure de test de [DevScripts](https://github.com/community-scripts/DevScripts) : elle remplace les adresses de community-scripts par celles d'un fork.
