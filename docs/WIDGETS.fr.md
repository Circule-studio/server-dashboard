# Widgets

🇬🇧 [English version](WIDGETS.md) · [Retour au README](../README.fr.md) · [Guide](GUIDE.fr.md)

Les 40 widgets, par famille, puis [où trouver leurs identifiants](#où-trouver-les-identifiants). Tu en ajoutes un avec **Connexion > Éditer > + Widget**.

## Serveurs et sauvegardes

- **Proxmox VE** : stats de l’hôte, VM et conteneurs LXC, stockages.
- **Proxmox Backup Server** : sauvegardes réussies et en échec des dernières 24 h, occupation des datastores.
- **Sauvegardes Proxmox** : dernière sauvegarde (date, succès ou échec), taille et date par machine, machines dans aucune sauvegarde planifiée, stockage et prochaine sauvegarde ; alerte en cas d’échec.
- **Sauvegarde par script** : le résultat d’un script maison (rsync vers un disque USB…) : date, taille, succès ou échec, historique ; alerte en cas d’échec ou de retard.
- **Pulse** : santé globale, alertes actives, nœuds / VM / LXC, en blocs à placer où tu veux.
- **Glances** : CPU, mémoire, disques, température et uptime d’une autre machine (PC, Raspberry Pi, NAS…), un widget par machine ; une machine éteinte est clairement signalée.
- **Agent** : CPU, mémoire, disques et température d’une machine derrière un NAT ou sans port ouvert ; c’est elle qui contacte le dashboard. Voir [agent/README.md](../agent/README.md).
- **Mises à jour** : paquets apt (dont ceux de sécurité) et images Docker en attente, pour le serveur du dashboard et chaque machine avec un agent. Affichage seulement, rien n’est installé.
- **Scrutiny** : santé SMART des disques, ceux en échec en premier, avec leur température.
- **Watchtower** : conteneurs vérifiés, à mettre à jour et en échec lors du dernier passage.

## Médias

- **Jellyfin / Plex** : lectures en cours (utilisateur, progression, pause) et taille de la bibliothèque.
- **qBittorrent** : débits, torrents actifs, progression et temps restant.
- **Sonarr / Radarr / Lidarr / Readarr** : épisodes, films, albums et livres à venir, file de téléchargement.
- **Prowlarr** : indexeurs actifs et en pause, requêtes et téléchargements récupérés. **Bazarr** : épisodes et films sans sous-titres.
- **Spotify** : ce qui joue en ce moment (titre, pochette, progression, appareil) et les dernières écoutes, cachées aux visiteurs non connectés.
- **Immich** : nombre de photos et de vidéos, stockage utilisé, détail par utilisateur avec les quotas. Si un compteur de téléchargements `dl-stats` est placé devant Immich, ses totaux (téléchargements, photos téléchargées, visiteurs) s’affichent aussi.

## Réseau et sécurité

- **Pi-hole / AdGuard Home** : requêtes DNS, requêtes bloquées et pourcentage, état de la protection (avec la pause en cours).
- **CrowdSec** : les attaques détectées sur ton serveur dans les dernières 24 h (adresse, pays, opérateur, scénario), les plus actifs, et les adresses bannies ; alerte en cas de pic.
- **Wazuh** : les agents actifs et déconnectés, et, avec l’indexer, les alertes de sécurité des 24 h par gravité ; alerte quand un agent se déconnecte ou en cas d’alerte critique.
- **Authelia** : connexions réussies, refusées et bloquées, double authentification, accès autorisés et refusés.
- **Traefik** : routeurs, services et middlewares, avec ceux en erreur ou en alerte ; alerte quand un routeur tombe en erreur.
- **Nginx Proxy Manager** : hôtes actifs et désactivés, certificats SSL triés par date d’expiration, ceux qui expirent dans les 14 jours mis en évidence.
- **Uptime Kuma** : sondes d’une page de statut, celles en panne en premier, avec le temps de réponse et la disponibilité sur 24 h.
- **Speedtest Tracker** : dernier test de débit, moyenne sur 7 jours et derniers tests.

## Maison et quotidien

- **Home Assistant** : les capteurs choisis (température, consommation, portes, mouvement, lumières, présence…), avec leur état traduit et depuis quand.
- **Frigate** : caméras en ligne et images par seconde, vitesse de détection, derniers événements (personne, voiture…) avec leur miniature, servie par le dashboard.
- **Météo** : température actuelle et prévisions sur 5 jours ([Open-Meteo](https://open-meteo.com), sans clé API).
- **Calendrier** : les événements des 7 prochains jours d’un ou plusieurs agendas iCal (Nextcloud, Google Agenda, Proton…), récurrents compris, groupés par jour.
- **Flux RSS / Atom** : les 10 derniers articles d’un ou plusieurs flux, mélangés par date.

## Web et développement

- **Loki / Grafana** : volume de logs et erreurs des dernières 24 h, avec les dernières lignes d’erreur et les sources les plus bavardes.
- **GoAccess** : visiteurs uniques d’un site (total, aujourd’hui, 7 derniers jours), requêtes et trafic, lus dans un rapport JSON de GoAccess.
- **Alwaysdata** : les sites d’un compte d’hébergement, chacun testé par le dashboard (en ligne, en panne, temps de réponse), ceux en panne en premier.
- **GitHub** : suivre un dépôt, avec sa dernière version, les commits non publiés depuis, les issues et les pull requests ouvertes.
- **API personnalisée** : n’importe quelle API JSON (service sans widget, script maison) : on choisit les valeurs à afficher par leur chemin dans la réponse, avec un format (nombre, pourcentage, octets, débit, date).

## Où trouver les identifiants

| Service | Champs | Où les trouver |
|---|---|---|
| Jellyfin | URL + clé API | Tableau de bord > Clés API > « + » |
| Plex | URL + token | Valeur `X-Plex-Token` ([doc Plex](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) |
| qBittorrent | URL + utilisateur / mot de passe de la WebUI | Options > Interface web |
| Sonarr / Radarr / Lidarr / Readarr / Prowlarr | URL + clé API | Settings > General > API Key |
| Bazarr | URL (`http://IP:6767`) + clé API | Settings > General > Security > API Key |
| Pulse | URL (`http://IP:7655`) + jeton d’API | Pulse > Paramètres > API Access, scope `monitoring:read` |
| Proxmox VE | URL (`https://IP:8006`) + identifiant et secret d’un jeton d’API | Voir ci-dessous |
| Proxmox Backup Server | URL (`https://IP:8007`) + identifiant et secret d’un jeton d’API | Configuration > Access Control > API Token, avec le rôle **Audit** sur `/` pour le jeton (lecture seule) |
| Scrutiny | URL de l’interface (`http://IP:8080`) | Aucune clé |
| Speedtest Tracker | URL + jeton d’API facultatif | v1 : Settings > API Tokens (lecture). Sans jeton : ancienne API publique (v0) |
| Pi-hole (v6) | URL (`http://IP`) + mot de passe | Celui de l’interface web. Avec la 2FA : mot de passe d’application (Paramètres > Web interface / API, mode Expert, « Configure app password »). Vide si Pi-hole n’a pas de mot de passe |
| AdGuard Home | URL (`http://IP`) + utilisateur / mot de passe | Ceux de l’interface web (vides si elle n’en a pas) |
| Immich | URL (`http://IP:2283`) + clé API | Paramètres du compte > Clés API, avec un compte **administrateur** (permission `server.statistics` si la clé est limitée) |
| Calendrier | Adresse(s) `.ics` + identifiant / mot de passe facultatifs | Nextcloud : ⋯ > Copier le lien privé ; Google Agenda : Paramètres > Adresse secrète au format iCal. Plusieurs agendas : adresses séparées par un espace. L’adresse est gardée sur le serveur comme une clé |
| GoAccess | URL du rapport JSON (`goaccess … -o rapport.json`) | Aucune clé. Pour ne rien exposer de sensible, génère un rapport limité au panneau des visiteurs (`--ignore-panel` pour tous les autres, dont `HOSTS`) : il ne contient aucune adresse IP |
| Alwaysdata | Jeton d’API + nom du compte (facultatif) | Alwaysdata > Profil > Gestion des jetons. Le compte n’est utile que si le jeton en gère plusieurs. Le widget lit seulement la liste des sites, puis teste lui-même leur première adresse (HTTPS, sinon HTTP) |
| Wazuh | URL de l’API du manager (`https://IP:55000`) + utilisateur et mot de passe de l’API ; facultatif : URL de l’indexer (`https://IP:9200`) et `utilisateur:mot de passe` de l’indexer | Compte de l’API Wazuh (idéalement avec le rôle `readonly`). Sans l’indexer, seuls les agents s’affichent. Certificats auto-signés acceptés |
| Spotify | Client ID + Client Secret d’une application créée sur [developer.spotify.com](https://developer.spotify.com/dashboard), puis connexion du compte dans le widget | Son propriétaire doit avoir **Spotify Premium** (règle de Spotify). Enregistre le widget, rouvre-le et suis les trois étapes. Le dashboard n’étant pas en https, la page de retour ne s’affiche pas : recopie son adresse. La connexion est à refaire tous les 6 mois |
| Loki / Grafana | URL de Loki (`http://IP:3100`) ; identifiant et mot de passe si un reverse proxy la protège ; ou URL de Grafana avec le chemin de la source (`https://grafana/api/datasources/proxy/uid/UID`) et un jeton de compte de service (rôle Viewer) | Sélecteur LogQL facultatif, ex. `{job="varlogs"}`. Les lignes d’erreur ne sont montrées qu’aux admins |
| Authelia | URL des métriques (`http://IP:9959`) | Dans sa configuration : `telemetry: { metrics: { enabled: true } }`. Compteurs depuis son démarrage. Authelia ne publie pas le nombre de sessions actives |
| Watchtower | URL de l’API (`http://IP:8080`) + jeton | Lancer avec `WATCHTOWER_HTTP_API_METRICS=true` et `WATCHTOWER_HTTP_API_TOKEN`. Ses métriques ne donnent ni le nom des conteneurs ni la date du passage : le dashboard note quand il voit un nouveau passage. Pour les noms, voir le widget Mises à jour. Watchtower n’est plus maintenu depuis 2025 |
| Sauvegardes Proxmox | Comme Proxmox VE : URL, identifiant et secret du jeton (rôle PVEAuditor) | Lit les tâches `vzdump` et les stockages de sauvegarde, y compris un disque USB monté dans Proxmox |
| Sauvegarde par script | Rien : le jeton est généré | Enregistre le widget, rouvre-le, et colle les lignes affichées à la fin de ton script. Adapte le chemin et `everyHours` (heures entre deux sauvegardes, pour détecter un retard) |
| Traefik | URL de l’API (`http://IP:8080` ou le routeur qui publie `api@internal`) ; utilisateur et mot de passe si un middleware basicAuth la protège | Activer `api.dashboard` (ou `api.insecure` sur un réseau privé) dans la configuration statique de Traefik |
| CrowdSec | URL de l’API locale (`http://IP:8080`) + compte machine **ou** clé de bouncer | Sur la machine CrowdSec : `cscli machines add dashboard --password …` (attaques détaillées : pays, opérateur, scénario) ou `cscli bouncers add dashboard` (lecture seule : adresses bannies). La liste communautaire n’est pas comptée comme une attaque |
| Météo | Lieu : ville (`Nantes`, `Paris, France`) ou coordonnées (`47.21, -1.55`) | Aucun compte. L’URL est facultative : seulement pour une instance Open-Meteo auto-hébergée |
| Uptime Kuma | URL (`http://IP:3001`) + nom de la page de statut, ou l’adresse complète de la page | Aucune clé : les pages de statut sont publiques (Uptime Kuma > Pages de statut) |
| Glances | URL (`http://IP:61208`) + mot de passe facultatif | Lance `glances -w` sur la machine (avec `--password` pour en exiger un ; utilisateur `glances` par défaut) |
| Frigate | URL (`http://IP:5000`), ou `https://IP:8971` + utilisateur / mot de passe | Port 5000 : rien à saisir. Port 8971 (Frigate 0.14+) : un compte Frigate, idéalement avec le rôle « viewer ». Les miniatures passent par le dashboard et suivent `REQUIRE_LOGIN` |
| Home Assistant | URL (`http://IP:8123`) + jeton + entités (une par ligne) | Ton profil > Sécurité > Jetons d’accès longue durée. Les identifiants d’entités (`sensor.salon_temperature`) sont dans Paramètres > Appareils et services > Entités |
| Nginx Proxy Manager | URL (`http://IP:81`) + e-mail / mot de passe | Le compte de l’interface d’administration. Un compte dédié avec la permission « Proxy Hosts » en lecture suffit |
| GitHub | Dépôt (`propriétaire/dépôt` ou son adresse) + jeton facultatif | Jeton obligatoire pour un dépôt privé : Settings > Developer settings > *Fine-grained tokens*, en lecture seule (Contents, Issues, Pull requests, Metadata). Sans jeton, GitHub limite à 60 requêtes par heure : rafraîchi toutes les 15 min (2 min avec un jeton), ce qui permet 4 à 5 widgets. Si la limite est atteinte, les dernières données restent affichées. L’URL de l’API ne sert que pour GitHub Enterprise |
| API personnalisée | URL qui renvoie du JSON + valeurs (une par ligne : `chemin \| libellé \| format`) + authentification facultative | Chemin avec des points : `data.users.count`, `items.0.name`, `liste.length`. Formats : texte, nombre, pourcentage, octets, débit, date. Authentification : un en-tête (`X-Api-Key: …`, ou une valeur seule envoyée en `Authorization: Bearer …`) ou identifiant / mot de passe (Basic) |
| Agent | Le nom de la machine | Enregistre le widget, rouvre-le et lance la commande affichée. Voir [agent/README.md](../agent/README.md) |
| Mises à jour | Rien | Il suit le serveur du dashboard et les machines qui ont un widget Agent |
| Flux RSS / Atom | Adresse des flux, une par ligne (10 au plus) | Aucune clé |

**Pulse** : coche les blocs à afficher (Santé, Alertes, Nœuds / VM / LXC). Pour les placer librement, ajoute plusieurs widgets Pulse avec chacun un bloc, puis déplace-les par glisser-déposer.

**Proxmox VE** : le widget affiche les stats de l’hôte (CPU, RAM, disque), l’état de toutes les VM et conteneurs LXC, et les stockages. C’est la façon de voir la machine complète quand le dashboard tourne lui-même dans un LXC, qui ne voit que ses propres limites. Crée un jeton en **lecture seule** dans le shell de l’hôte Proxmox :

```bash
pveum user token add root@pam dashboard --privsep 1
pveum acl modify / --tokens "root@pam!dashboard" --roles PVEAuditor
```

La première commande affiche le secret (une seule fois). Dans le widget : identifiant `root@pam!dashboard`, secret = la valeur `value` affichée.

Les URL doivent être joignables **depuis le serveur du dashboard** (par exemple `http://jellyfin:8096` si les deux sont dans le même réseau Docker). Les clés et mots de passe restent sur le serveur : ils ne sont jamais renvoyés au navigateur.
