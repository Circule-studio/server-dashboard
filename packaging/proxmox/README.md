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
- [x] `ct/server-dashboard.sh` testé sur un vrai Proxmox VE 9.1 (29/10/2026) : création du LXC (Debian 13, 1 cœur, 512 Mo, 2 Go), connexion avec le mot de passe de `~/server-dashboard.creds`, puis `update` (0.15.0 → 0.16.0) avec config et réglages conservés.
- [ ] Hôte ARM64 (Raspberry Pi avec Proxmox).
- [ ] Fiche JSON de l'application, demandée par community-scripts pour son site (voir leurs règles de contribution).
- [ ] Projet éligible (6 mois d'existence, environ 1 000 étoiles), puis PR sur [DevScripts](https://github.com/community-scripts/DevScripts).

## Tester sur un Proxmox

Sur l'hôte, en root, avec les scripts de ce dépôt à la place de ceux de community-scripts :

```bash
mode=default var_hostname=sd-test COMMUNITY_SCRIPTS_URL=https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/packaging/proxmox bash -c "$(curl -fsSL https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/packaging/proxmox/ct/server-dashboard.sh)"
```


Les scripts chargent leurs fonctions depuis `community-scripts/core`. Pour essayer avant toute PR, suis la procédure de test de [DevScripts](https://github.com/community-scripts/DevScripts) : elle remplace les adresses de community-scripts par celles d'un fork.
