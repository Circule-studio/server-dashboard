# Changelog

Toutes les évolutions notables du projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.13.2] - 2026-10-29

### Corrigé
- Dashboard plus réactif : quand les statuts des tuiles ou les données d’un widget ont expiré, le serveur renvoie les précédentes au bout de 300 ms au lieu d’attendre le service le plus lent (jusqu’à 5 s pour les pastilles, 2 à 3 s pour le widget Alwaysdata). Les nouvelles valeurs arrivent au rafraîchissement suivant. Les notifications attendent toujours des statuts frais.

## [0.13.1] - 2026-10-29

### Corrigé
- Widget Alwaysdata : un jeton limité à certaines adresses IP affiche un message clair (ajouter les adresses IPv4 et IPv6 du serveur du dashboard dans Alwaysdata, ou retirer la restriction) au lieu de « Authentification refusée ». Les adresses des sites s’affichent sans la barre oblique finale.

## [0.13.0] - 2026-10-29

### Ajouté
- Widget **Alwaysdata** : les sites d’un compte d’hébergement Alwaysdata, avec leur état. L’API ne donnant que la liste des sites et leurs adresses, le dashboard teste lui-même la première adresse de chacun (HTTPS, sinon HTTP) : en ligne avec le temps de réponse, ou en panne avec le code HTTP. Jeton d’API, compte facultatif. Faux Alwaysdata dans `npm run mocks` (#80).

## [0.12.0] - 2026-10-29

### Ajouté
- Widget **GoAccess** : visiteurs uniques d’un site (total, aujourd’hui et 7 derniers jours), requêtes et trafic, lus dans un rapport JSON de GoAccess, sans clé. La doc explique comment produire un rapport limité au panneau des visiteurs, qui ne contient aucune adresse IP. Faux GoAccess dans `npm run mocks`.

## [0.11.0] - 2026-10-29

### Ajouté
- Widget **Immich** : si un compteur de téléchargements `dl-stats` répond sur la même adresse (`/dl-stats/api/…`, même clé administrateur), le widget affiche aussi le nombre de téléchargements, de photos téléchargées et de visiteurs. Seuls les totaux sont lus : les noms et e-mails des visiteurs restent dans dl-stats. Sans dl-stats, rien ne change.

## [0.10.0] - 2026-10-29

### Ajouté
- **Redimensionner en hauteur** : la poignée en bas à droite règle maintenant la largeur **et** la hauteur des widgets et des catégories. Le contenu qui dépasse défile à l’intérieur, l’en-tête reste visible. Revenir près de la hauteur du contenu, ou double-cliquer sur la poignée, rétablit la hauteur automatique (#75).

## [0.9.1] - 2026-10-29

### Corrigé
- Site du projet : un visiteur francophone était toujours redirigé vers la version anglaise, à cause d’un caractère de contrôle invisible dans le test de la langue (depuis la 0.6.1). La CI refuse maintenant tout caractère de ce genre dans le dépôt.
- Widgets étroits (largeur par défaut, tablette) : les chiffres et leurs libellés n’étaient plus coupés (« 63 … », « CRITI… ») : deux chiffres par ligne quand la place manque, libellés sur deux lignes. Dans Proxmox et Pulse, la charge d’une VM passe sous son nom au lieu de le masquer.
- Widget Agent : l’attente du premier envoi n’est plus affichée en rouge comme une panne.

## [0.9.0] - 2026-10-29

### Ajouté
- Widget **GitHub** : on connecte un dépôt (`propriétaire/dépôt` ou son adresse) pour suivre sa dernière version, les commits non publiés depuis, la pré-release en cours, le dernier commit, les issues et les pull requests ouvertes (avec leurs labels et les brouillons). Blocs au choix, comme pour Pulse. Jeton facultatif, obligatoire pour un dépôt privé. Pour ménager la limite de GitHub (60 requêtes par heure sans jeton) : rafraîchissement toutes les 15 min sans jeton, requêtes conditionnelles (ETag, gratuites avec un jeton quand rien n’a changé), requêtes partagées entre widgets du même dépôt, et plus aucune requête jusqu’à l’heure de reprise une fois la limite atteinte. Le widget garde alors ses dernières données avec un avertissement, au lieu d’une erreur. GitHub Enterprise pris en charge. Faux GitHub dans `npm run mocks` (#63).
- Widget **Uptime Kuma** : les sondes d’une page de statut (publique, sans clé), celles en panne en premier avec leur message d’erreur, le temps de réponse et la disponibilité sur 24 h. On peut coller directement l’adresse de la page (`http://IP:3001/status/maison`). Faux Uptime Kuma dans `npm run mocks` (#64).
- Widget **Agent** : pour une machine derrière un NAT ou sans port ouvert, un petit script (`agent/server-dashboard-agent.js`, Node.js 18.15+, sans dépendance, Linux, macOS et Windows) envoie lui-même CPU, mémoire, disques, température et uptime toutes les 30 s. Le jeton est créé par le dashboard, qui affiche la commande prête à copier ; les valeurs reçues sont vérifiées et bornées ; sans nouvelles depuis 3 envois, le widget l’indique avec les dernières valeurs (#7).
- Widget **Glances** : superviser d’autres machines (PC, Raspberry Pi, NAS, 2e serveur…) sur le même dashboard, un widget par machine. CPU et charge, mémoire, disques, température la plus haute et uptime, avec les mêmes couleurs de saturation que les stats du serveur ; une machine éteinte ou hors du réseau est clairement signalée. API v4 ou v3 de Glances détectée, mot de passe facultatif. Faux Glances (deux machines) dans `npm run mocks` (#7).
- Widget **Frigate** : caméras en ligne (images par seconde et détection), vitesse du détecteur et derniers événements avec leur miniature et le nom reconnu (visage, plaque). Les miniatures passent par le dashboard (`/api/widgets/:id/thumbnail/:événement`) et respectent `REQUIRE_LOGIN` : Frigate n’est jamais exposé au navigateur. Port 5000 sans authentification, ou 8971 avec un compte Frigate (0.14+). Faux Frigate dans `npm run mocks` (#12).
- Widget **Home Assistant** : les entités choisies (une par ligne, 30 au plus) avec leur valeur et leur unité, ou un état traduit selon le type de capteur (porte ouverte, mouvement détecté, fuite d’eau, lumière allumée, présent / absent…) et depuis quand. Une entité supprimée est signalée sans faire échouer le widget. Une requête par entité, plutôt que toutes les entités de la maison. Faux Home Assistant dans `npm run mocks` (#13).
- Widget **Nginx Proxy Manager** : hôtes actifs et désactivés, certificats SSL triés par date d’expiration ; ceux qui expirent dans les 14 jours (ou déjà expirés) sont mis en évidence. Le jeton de connexion est réutilisé et renouvelé tout seul. Faux NPM dans `npm run mocks` (#11).
- **Notifications** (mode édition > Notifications) vers ntfy, Gotify, Discord ou un webhook (POST JSON) quand une application tombe, puis quand elle revient. Le serveur vérifie les tuiles toutes les minutes, même dashboard fermé ; une application n’est déclarée hors ligne qu’après deux échecs de suite, une seule notification par changement, aucune au démarrage. Bouton « Envoyer un test ». L’URL et le jeton restent sur le serveur (#65).
- **Sauvegarde de la configuration** (mode édition > Sauvegarde) : export en un fichier JSON, sans les secrets par défaut (partageable), ou avec les clés API et mots de passe pour une vraie sauvegarde ; import d’un fichier exporté ou d’un `data/config.json`, qui remplace le brouillon sans rien écrire avant « Enregistrer ». Les widgets déjà présents gardent leurs secrets si le fichier n’en contient pas (#66).
- **Catalogue d’applications connues** dans « Nouvelle application » : taper « jelly » propose Jellyfin, et le choisir remplit le nom, l’icône, la description et l’URL avec le port par défaut. L’adresse est présélectionnée : il ne reste qu’à taper l’IP. 50 applications pour commencer (Jellyfin, *arr, Immich, Home Assistant, Proxmox…), dans `public/catalog.js` (#14).
- **Taille des tuiles** (mode édition > Affichage) : compacte (icône et nom, plus de tuiles par ligne), normale ou grande (grande icône, description sur deux lignes). Le choix est enregistré dans la configuration (#6).
- **Brouillon des scripts Proxmox VE** pour community-scripts (`packaging/proxmox/`) : création du conteneur LXC, installation sans Docker (service systemd, utilisateur dédié, mot de passe généré) et mise à jour qui garde la config. Le script d’installation est testé par la CI ; reste à tester `ct/` sur un vrai Proxmox (#15).

### Modifié
- Faux **Plex** dans `npm run mocks` (il répond en XML sauf si on demande du JSON, comme le vrai) et tests du widget : tous les widgets sont maintenant testés (#67).
- **Un fichier par intégration** : `integrations/<service>.js` côté serveur, `public/widgets/<service>.js` côté interface et `dev/mocks/<service>.js` pour les faux services. Ajouter un widget ne touche plus les fichiers des autres, et les contributions ne se marchent plus dessus (voir « Ajouter un widget » dans CONTRIBUTING.md) (#48).
- `check-i18n` (CI) : une clé de traduction est vérifiée où qu'elle soit écrite dans `app.js`, même dans une condition (`t(cond ? 'clé.a' : 'clé.b')`), et les pluriels `tp()` sont vérifiés dans leurs deux formes (#46).
- Vérification des **noms d’icônes** (catalogue et widgets) sur dashboardicons.com : `node dev/check-icons.js`, lancé par un workflow à part à chaque modification et chaque semaine.
- **Tests automatiques des widgets** (`npm test`, lancé par la CI) : avec les faux services, un widget de chaque type est vérifié, ainsi que les principaux cas d’erreur (code traduit) et l’absence de tout secret dans `/api/config`. Uniquement `node:test`, sans dépendance (#45).
- La configuration est gardée en mémoire au lieu d’être relue et analysée à chaque requête (stats toutes les 5 s, chaque widget…). Une modification à la main de `data/config.json` est toujours prise en compte : le fichier est relu dès que sa date ou sa taille change (#47).

### Corrigé
- Le dashboard ne démarre plus « dans le vide » quand son port est déjà utilisé : il affiche une erreur claire et s’arrête avec le code 1, ce qui permet à systemd de le signaler (avant, il annonçait démarrer puis s’arrêtait avec le code 0).
- La clé API ou le mot de passe d’un widget n’est plus conservé quand on change son type tout en gardant son identifiant (une clé Sonarr ne part plus vers un Radarr).

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

[Non publié]: https://github.com/Circule-studio/server-dashboard/compare/v0.13.2...HEAD
[0.13.2]: https://github.com/Circule-studio/server-dashboard/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/Circule-studio/server-dashboard/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/Circule-studio/server-dashboard/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Circule-studio/server-dashboard/compare/v0.8.0...v0.9.0
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
