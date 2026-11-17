---
description: Audit strict du code par le dev senior, qui ouvre une issue GitHub par problème confirmé
argument-hint: "[dossier, fichier ou widget à relire : tout le dépôt par défaut]"
---

Lance l'agent `dev-senior` pour auditer le code de Server Dashboard.

Périmètre : $ARGUMENTS (si rien n'est indiqué : tout le dépôt).

Quand il a fini, donne-moi son rapport tel quel : les issues créées avec leur lien et leur gravité, les
doublons trouvés, les failles de sécurité gardées hors issue, et ce qu'il a écarté après vérification.
