# Changelog

Toutes les évolutions notables du projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté
- Widget **GitHub** : on connecte un dépôt (`propriétaire/dépôt` ou son adresse) pour suivre sa dernière version, les commits non publiés depuis, la pré-release en cours, le dernier commit, les issues et les pull requests ouvertes (avec leurs labels et les brouillons). Blocs au choix, comme pour Pulse. Jeton facultatif, obligatoire pour un dépôt privé ; sans jeton, les données sont rafraîchies toutes les 15 min pour rester sous la limite de GitHub, et un dépassement affiche quand réessayer. GitHub Enterprise pris en charge. Faux GitHub dans `npm run mocks` (#63).

## [0.8.0] - 2026-10-28

### Ajouté
- **Grille de mise en page** : widgets et catégories partagent une grille de 12 colonnes. En mode édition, on les déplace par glisser-déposer et on règle leur largeur avec la poignée en bas à droite ; la hauteur suit le contenu et les éléments s’emboîtent sans trou. 6 colonnes sur tablette, 1 sur téléphone. Une config existante garde son affichage (widgets en largeur 3, catégories en pleine largeur) (#61).
- **Tout se réorganise par glisser-déposer**, à la souris comme **au doigt** : tuiles, widgets, catégories (par leur titre) et **cartes de stats** du haut, dont l’ordre est enregistré. Les flèches ← → ↑ ↓ du mode édition disparaissent ; au clavier, Tab sélectionne un élément et les flèches le déplacent (#60, #2).
- **Popup d’enregistrement** en bas de l’écran dès qu’une modification n’est pas enregistrée (Annuler / Enregistrer), à la place du bouton en haut à droite. Raccourci Ctrl / Cmd + S, et confirmation avant de fermer l’onglet, de se déconnecter ou de quitter l’édition avec des modifications en cours (#59).

### Modifié
- **Téléphone** : barre du haut plus compacte (horloge masquée), barre d’édition qui ne reste plus collée en haut et dont les boutons tiennent sur une ligne qui défile au doigt (#2).

## [0.7.0] - 2026-10-27

### Ajouté
- **Thème clair** : suit le thème du système par défaut, bouton ☀️ / 🌙 dans la barre du haut pour forcer l’un ou l’autre (choix mémorisé) (#1).
- **Recherche rapide** dans les tuiles : touche `/`, filtre sur le nom, la description et la catégorie (sans accents ni majuscules), Entrée ouvre la première tuile, Échap vide le champ (#5).
- Widget **Météo** : température actuelle, ressenti, vent et prévisions sur 5 jours avec [Open-Meteo](https://open-meteo.com) (gratuit, sans clé API). Le lieu est un nom de ville ou des coordonnées ; une instance Open-Meteo auto-hébergée peut être utilisée. Faux Open-Meteo dans `npm run mocks` (#3).
- Widget **Immich** : nombre de photos et de vidéos, stockage utilisé et détail par utilisateur (avec la jauge du quota s’il y en a un). Message clair si la clé n’est pas celle d’un administrateur. Faux Immich dans `npm run mocks` (#10).
- Widgets **Pi-hole** (v6) et **AdGuard Home** : requêtes DNS, requêtes bloquées et pourcentage, état de la protection et pause en cours ; domaines bloqués et clients actifs (Pi-hole), temps de réponse moyen (AdGuard). La session Pi-hole est réutilisée et fermée quand la config change, pour ne pas épuiser les places limitées de son API. Faux Pi-hole et AdGuard dans `npm run mocks` (#4).
- **Options d’affichage** (mode édition > Affichage) : masquer la barre de recherche (elle s’ouvre quand même avec `/`), le bouton de thème ou le bouton de langue. Sans bouton, le thème suit le système et la langue celle du navigateur.

### Corrigé
- Config : un élément invalide (`null`, texte…) renvoie une erreur « Requête invalide » au lieu de l’erreur JavaScript brute, et un identifiant en double (widget, catégorie, app) est remplacé à l’enregistrement au lieu de mélanger les données (#51, #52). Une installation neuve est aussi protégée contre l’écrasement par un autre onglet dès le premier enregistrement.
- Un widget en erreur réessaie au bout de 30 s, puis 1 min, 2 min… au lieu d’attendre son intervalle normal (jusqu’à 10 min pour la météo) (#54).
- Widget Météo avec une instance Open-Meteo auto-hébergée : un nom de ville fonctionne (la ville est cherchée sur le service public de géocodage quand l’instance ne le propose pas) (#53).
- Un mot de passe ou une clé API enregistré peut être effacé : case « Effacer » sous le champ (utile pour Pi-hole, AdGuard ou qBittorrent sans mot de passe). Avant, un champ vide voulait toujours dire « inchangé » (#42).
- `install.sh` : un mot de passe contenant des guillemets, une apostrophe, un antislash, un dollar ou un accent grave (ou des espaces en début ou fin) est refusé avec un message clair, avant toute installation, au lieu d’être enregistré modifié (#44).
- Widget Météo : les coordonnées avec une virgule décimale (`47,21 ; -1,55`) sont reconnues au lieu d’être cherchées comme un nom de ville (#43).

### Sécurité
- Une session fermée avec « Déconnexion » reste fermée après un redémarrage du dashboard (les sessions fermées sont maintenant enregistrées dans `data/.revoked-sessions.json`). Avant, son cookie redevenait valide jusqu’à son expiration.
- Les réponses des services sont limitées à 10 Mo et à 20 s au total. Une URL de widget pointant vers un gros fichier faisait planter tout le dashboard, et un service très lent pouvait bloquer une requête indéfiniment.

## [0.6.1] - 2026-10-26

### Ajouté
- **Site du projet en anglais** (`/en/`) : bouton FR / EN, redirection automatique selon la langue du navigateur, roadmap dans les deux langues (#35).

### Modifié
- Image Docker basée sur **Node.js 26** (au lieu de 22) (#17).
- CI : `actions/setup-node` v7 (#16).

## [0.6.0] - 2026-10-26

### Ajouté
- **Interface en anglais** (et toujours en français) : langue détectée depuis le navigateur, bouton EN / FR dans la barre du haut, dates, unités et pluriels adaptés (#29).
- README en anglais (`README.en.md`).

### Modifié
- Le serveur renvoie des codes (données des widgets, erreurs) que l'interface traduit, au lieu de textes en français.

## [0.5.0] - 2026-10-26

### Ajouté
- **Image Docker publiée** sur `ghcr.io/circule-studio/server-dashboard` à chaque version, pour amd64 et arm64 (Raspberry Pi) : installation Docker sans cloner le dépôt ni construire l’image (#28).

### Modifié
- `docker-compose.yml` utilise l’image publiée ; README et site mis à jour (téléchargement des deux fichiers, `docker compose pull` pour mettre à jour).
- Première installation : config vide et **écran d’accueil** en trois étapes, au lieu de tuiles d’exemple qui s’affichaient en rouge (#30).

### Sécurité
- Bandeau d’avertissement pour l’admin connecté tant que le mot de passe par défaut `admin` est utilisé (jamais révélé aux visiteurs).

## [0.4.1] - 2026-10-26

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

[Non publié]: https://github.com/Circule-studio/server-dashboard/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/Circule-studio/server-dashboard/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Circule-studio/server-dashboard/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Circule-studio/server-dashboard/releases/tag/v0.1.0
