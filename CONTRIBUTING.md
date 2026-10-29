# Contribuer à Server Dashboard

Merci de ton aide ! Le projet cherche surtout des contributions sur **l'interface** : design, ergonomie, accessibilité, version mobile, nouveaux widgets.

## Démarrer en 2 minutes

Il faut Node.js 20 ou plus récent.

```bash
git clone <url-du-dépôt>
cd server-dashboard
npm install
npm run dev      # dashboard sur http://localhost:7575 (mot de passe : admin)
npm run mocks    # dans un 2e terminal : faux Jellyfin / qBittorrent / Sonarr / Radarr
```

Les identifiants des faux services sont en tête de `dev/mocks.js`. Ajoute les widgets via **Connexion > Éditer > + Widget**.

## Où est quoi

| Fichier | Contenu |
|---|---|
| `public/index.html` | Structure de la page et des fenêtres de dialogue |
| `public/style.css` | Tout le style (les couleurs sont des variables dans `:root`) |
| `public/app.js` | Logique de l'interface : rendu des tuiles et widgets, mode édition, rafraîchissement |
| `public/catalog.js` | Catalogue d'applications connues (nom, icône, port par défaut) : un objet par application, facile à compléter |
| `server.js` | API Express : config, auth, statut, stats système, Docker |
| `integrations.js` | Appels aux services (Jellyfin, Plex, qBittorrent, Sonarr, Radarr) et normalisation des données |
| `dev/mocks.js` | Faux services pour le développement |

L'interface est en HTML/CSS/JS sans framework ni étape de build : on modifie, on recharge la page.

## Traductions

L'interface est en français et en anglais. Tous les textes sont dans [`public/i18n.js`](public/i18n.js) : on les affiche avec `t('clé')` dans `public/app.js`, ou avec un attribut `data-i18n="clé"` dans `public/index.html`. **Ajoute toujours la clé dans les deux langues.** Le serveur renvoie des codes (`movies`, `unreachable`…) que l'interface traduit : pas de texte affiché en dur côté serveur. Pour ajouter une langue, copie le bloc `en` et traduis-le.

## Ajouter un widget

1. Dans `integrations.js`, écris une fonction `async (widget) => données` et ajoute-la à `INTEGRATIONS` avec ses champs (`url`, `apiKey`, `username`, `password`, `location`, `repo`, `entities`). `cacheMs` règle la durée pendant laquelle les données sont partagées entre visiteurs (4 s par défaut, 10 min pour la météo) ; ce peut être une fonction du widget (GitHub : plus long sans jeton).
2. Dans `public/app.js`, ajoute le type à `WIDGET_TYPES` et, si besoin, un rendu dans `RENDERERS`.
3. Ajoute un faux service dans `dev/mocks.js` pour que tout le monde puisse le tester.
4. Ajoute le widget (et ses principaux cas d'erreur) dans `test/widgets.test.js`, puis lance `npm test` : les tests démarrent eux-mêmes les faux services et un dashboard temporaire. La CI les lance à chaque push.

## Branches

| Branche | Rôle |
|---|---|
| `preprod` | Branche de développement : **toutes les pull requests visent `preprod`**. On y teste les nouveautés avant de les publier. |
| `main` | Version stable, celle que les gens installent. Mise à jour en fusionnant `preprod` une fois testée. Le site du projet (`docs/`) est publié depuis `main`. |

Ces deux branches sont protégées :
- pas de push direct, pas de push forcé, pas de suppression ;
- toute modification passe par une *pull request* dont la CI doit être verte (syntaxe, ShellCheck, test d’installation) ;
- une relecture d’un mainteneur est requise (voir `.github/CODEOWNERS`) ;
- une PR vers `main` qui ne vient pas de `preprod` est refusée automatiquement.

Pour la première PR d’un nouveau contributeur, un mainteneur doit autoriser le lancement de la CI : c’est normal, ça protège le projet.

## Proposer une modification

1. Ouvre une *issue* pour discuter de l'idée si c'est un gros changement.
2. Fais un fork, crée une branche à partir de `preprod` (`git checkout -b ma-fonctionnalite origin/preprod`), commite, puis ouvre une *pull request* **vers `preprod`**.
3. Pour un changement visuel, ajoute une capture d'écran avant / après dans la PR.

## Sécurité

- Une faille de sécurité ? **Pas d’issue publique** : voir [SECURITY.md](SECURITY.md).
- Ne commite jamais de mot de passe, de clé API ou de fichier `.env`. Le scan de secrets de GitHub bloque la plupart des fuites, mais pas toutes.
- Merci de respecter le [code de conduite](CODE_OF_CONDUCT.md).

## Règles de code

- Garde le style existant : indentation de 2 espaces, guillemets simples, commentaires en français.
- Construis le DOM avec le helper `h()` (jamais `innerHTML` avec des données venant de la config ou des services).
- Les secrets (clés API, mots de passe) ne doivent jamais être envoyés au navigateur.
