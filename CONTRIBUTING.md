# Contribuer à Server Dashboard

Merci de ton aide ! Le projet cherche surtout des contributions sur **l'interface** : design, ergonomie, accessibilité, version mobile, nouveaux widgets.

## Démarrer en 2 minutes

Il faut Node.js 20 ou plus récent.

```bash
git clone <url-du-dépôt>
cd server-dashboard
npm install
npm run dev      # dashboard sur http://localhost:7575 (mot de passe : admin)
npm run mocks    # dans un 2e terminal : un faux service par widget, et un faux Docker
```

Les identifiants des faux services sont en tête de `dev/mocks.js`. Ajoute les widgets via **Connexion > Éditer > + Widget**.

## Où est quoi

| Fichier | Contenu |
|---|---|
| `public/index.html` | Structure de la page et des fenêtres de dialogue |
| `public/style.css` | Tout le style (les couleurs sont des variables dans `:root`) |
| `public/app.js` | Logique de l'interface : rendu des tuiles, mode édition, rafraîchissement, outils partagés (`h()`, `fmtAgo`…) |
| `public/widgets/<service>.js` | Un widget : son type (`WIDGET_TYPES`) et son rendu (`RENDERERS`) |
| `public/catalog.js` | Catalogue d'applications connues (nom, icône, port par défaut) : un objet par application, facile à compléter |
| `server.js` | API Express : config, auth, statut, stats système, Docker |
| `integrations/<service>.js` | Appels à un service et normalisation des données ; `integrations/index.js` les rassemble, `integrations/lib.js` contient les outils communs (requêtes, erreurs, sessions) |
| `dev/mocks/<service>.js` | Un faux service pour le développement ; `dev/mocks.js` les lance tous (identifiants en tête du fichier) |
| `test/widgets.test.js` | Tests de bout en bout des widgets avec les faux services (`npm test`) |

L'interface est en HTML/CSS/JS sans framework ni étape de build : on modifie, on recharge la page.

## Traductions

L'interface est en français et en anglais. Tous les textes sont dans [`public/i18n.js`](public/i18n.js) : on les affiche avec `t('clé')` dans `public/app.js` et `public/widgets/`, ou avec un attribut `data-i18n="clé"` dans `public/index.html`. **Ajoute toujours la clé dans les deux langues.** Le serveur renvoie des codes (`movies`, `unreachable`…) que l'interface traduit : pas de texte affiché en dur côté serveur. Pour ajouter une langue, copie le bloc `en` et traduis-le.

## Ajouter un widget

Chaque widget tient dans trois fichiers à son nom, sans toucher à ceux des autres : deux contributions ne se marchent plus dessus.

1. **Serveur** : crée `integrations/<service>.js`. Il exporte `{ <type>: { fields, fetch } }` : `fetch` est une fonction `async (widget) => données`, `fields` la liste des champs (`url`, `apiKey`, `username`, `password`, `location`, `repo`, `entities`, `slug`). Options : `cacheMs`, `sections`, `userRequired`, `reset()` (détails en tête de `integrations/index.js`). Ajoute le nom du fichier à `FILES` dans `integrations/index.js`. Les outils communs (`request`, `getJson`, `fail`, `sessionCache`…) sont dans `integrations/lib.js`.
2. **Interface** : crée `public/widgets/<service>.js`, avec `WIDGET_TYPES.<type> = { label, icon, kind, refresh… }` et `RENDERERS.<kind> = (données, widget) => éléments`, puis ajoute une balise `<script>` dans `public/index.html`, après `app.js`, à l'endroit voulu dans la liste « Type ». Prends exemple sur `public/widgets/immich.js`, le plus court.
3. **Faux service** : crée `dev/mocks/<service>.js` et ajoute-le à `SERVICES` dans `dev/mocks.js`, avec ses identifiants dans l'en-tête de ce fichier.
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
