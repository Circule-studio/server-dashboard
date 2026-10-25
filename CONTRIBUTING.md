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
| `server.js` | API Express : config, auth, statut, stats système, Docker |
| `integrations.js` | Appels aux services (Jellyfin, Plex, qBittorrent, Sonarr, Radarr) et normalisation des données |
| `dev/mocks.js` | Faux services pour le développement |

L'interface est en HTML/CSS/JS sans framework ni étape de build : on modifie, on recharge la page.

## Ajouter un widget

1. Dans `integrations.js`, écris une fonction `async (widget) => données` et ajoute-la à `INTEGRATIONS` avec ses champs (`url`, `apiKey`, `username`, `password`).
2. Dans `public/app.js`, ajoute le type à `WIDGET_TYPES` et, si besoin, un rendu dans `RENDERERS`.
3. Ajoute un faux service dans `dev/mocks.js` pour que tout le monde puisse le tester.

## Branches

| Branche | Rôle |
|---|---|
| `preprod` | Branche de développement : **toutes les pull requests visent `preprod`**. On y teste les nouveautés avant de les publier. |
| `main` | Version stable, celle que les gens installent. Mise à jour en fusionnant `preprod` une fois testée. Le site du projet (`docs/`) est publié depuis `main`. |

## Proposer une modification

1. Ouvre une *issue* pour discuter de l'idée si c'est un gros changement.
2. Fais un fork, crée une branche à partir de `preprod` (`git checkout -b ma-fonctionnalite origin/preprod`), commite, puis ouvre une *pull request* **vers `preprod`**.
3. Pour un changement visuel, ajoute une capture d'écran avant / après dans la PR.

## Règles de code

- Garde le style existant : indentation de 2 espaces, guillemets simples, commentaires en français.
- Construis le DOM avec le helper `h()` (jamais `innerHTML` avec des données venant de la config ou des services).
- Les secrets (clés API, mots de passe) ne doivent jamais être envoyés au navigateur.
