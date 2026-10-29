# Politique de sécurité

## Signaler une faille

**N'ouvre pas d'issue publique pour une faille de sécurité.** Utilise le signalement privé de GitHub :

👉 [Signaler une vulnérabilité](https://github.com/Circule-studio/server-dashboard/security/advisories/new) (onglet **Security** > **Report a vulnerability**)

Indique si possible :
- la version concernée (tag ou commit) et le mode d'installation (Docker ou systemd) ;
- les étapes pour reproduire ;
- l'impact possible (accès sans mot de passe, fuite de clé API, contrôle de Docker…).

Nous répondons en général sous 7 jours. Une fois la faille corrigée, nous publions un avis de sécurité, avec ton nom si tu le souhaites.

## Versions prises en charge

| Version | Correctifs de sécurité |
|---|---|
| Dernière version publiée | ✅ |
| Versions plus anciennes | ❌ (mets à jour) |

## Points d'attention pour les utilisateurs

- **Le panneau Docker donne un accès équivalent à root sur la machine.** N'expose pas le dashboard directement sur Internet : passe par un reverse proxy en HTTPS ou un VPN, et active `REQUIRE_LOGIN=true` s'il est accessible depuis l'extérieur.
- Ne mets jamais de mot de passe ou de clé API dans `compose.yaml` ni dans un fichier suivi par Git : utilise `.env` (Docker) ou `/etc/server-dashboard/server-dashboard.env` (systemd).
- Change le mot de passe par défaut : changer `ADMIN_PASSWORD` déconnecte aussi toutes les sessions ouvertes.
