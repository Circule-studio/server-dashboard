#!/usr/bin/env bash
# Installe ou met à jour Server Dashboard sans Docker
# (Debian / Ubuntu, conteneur LXC Proxmox, VM, Raspberry Pi…).
#
#   curl -fsSL https://raw.githubusercontent.com/Circule-studio/server-dashboard/main/packaging/install.sh | sudo bash
#
# Relancer la même commande met à jour vers la dernière release en gardant la config.
# Désinstaller : … | sudo bash -s -- --uninstall   (ajouter --purge pour effacer aussi la config)
#
# Variables facultatives :
#   SD_VERSION         version à installer (ex. v0.1.0), sinon la dernière release
#   SD_PORT            port HTTP, 7575 par défaut (première installation seulement)
#   SD_ADMIN_PASSWORD  mot de passe admin, généré sinon (première installation seulement)
#   SD_SOURCE_DIR      installe depuis un dossier local au lieu de GitHub (tests)
set -euo pipefail

REPO="Circule-studio/server-dashboard"
APP_DIR="/opt/server-dashboard"
DATA_DIR="/var/lib/server-dashboard"
CONF_DIR="/etc/server-dashboard"
ENV_FILE="$CONF_DIR/server-dashboard.env"
SERVICE="server-dashboard"
SERVICE_USER="server-dashboard"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
NODE_MAJOR=22
MIN_NODE_MAJOR=20

# Évite les avertissements de locale des modèles LXC minimaux et la notice de mise à jour de npm.
export LC_ALL=C.UTF-8 LANG=C.UTF-8
export NPM_CONFIG_UPDATE_NOTIFIER=false

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "lance ce script en root (avec sudo)."
command -v systemctl >/dev/null || fail "systemd est requis."

# ---------- Désinstallation ----------
if [[ "${1:-}" == "--uninstall" ]]; then
  info "Désinstallation"
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
  rm -rf "$APP_DIR"
  if [[ "${2:-}" == "--purge" ]]; then
    rm -rf "$DATA_DIR" "$CONF_DIR"
    userdel "$SERVICE_USER" 2>/dev/null || true
    info "Config et données supprimées."
  else
    info "Config conservée dans $CONF_DIR et $DATA_DIR (ajoute --purge pour l'effacer)."
  fi
  exit 0
fi

command -v apt-get >/dev/null || fail "seules Debian et Ubuntu sont prises en charge pour l'instant."

UPDATE=false
[[ -f "$APP_DIR/server.js" ]] && UPDATE=true

# ---------- Dépendances système ----------
info "Paquets de base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg tar openssl >/dev/null

node_major() {
  if command -v node >/dev/null; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi
}
if (( $(node_major) < MIN_NODE_MAJOR )); then
  info "Installation de Node.js $NODE_MAJOR (dépôt NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"
info "Node.js $(node -v)"

# ---------- Code source ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src"

if [[ -n "${SD_SOURCE_DIR:-}" ]]; then
  info "Installation depuis $SD_SOURCE_DIR"
  tar -C "$SD_SOURCE_DIR" --exclude=./node_modules --exclude=./data --exclude=./.git --exclude=./.env -cf - . \
    | tar -C "$TMP/src" -xf -
  VERSION="local"
else
  VERSION="${SD_VERSION:-}"
  if [[ -z "$VERSION" ]]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  fi
  [[ -n "$VERSION" ]] || fail "impossible de trouver la dernière release de $REPO."
  if $UPDATE && [[ "$(cat "$APP_DIR/VERSION" 2>/dev/null)" == "$VERSION" ]]; then
    info "Déjà à jour ($VERSION)."
    exit 0
  fi
  info "Téléchargement de $VERSION"
  curl -fsSL "https://github.com/$REPO/archive/refs/tags/$VERSION.tar.gz" | tar -xz -C "$TMP/src" --strip-components=1
fi
[[ -f "$TMP/src/server.js" ]] || fail "archive invalide : server.js introuvable."

info "Dépendances Node.js"
(cd "$TMP/src" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# ---------- Utilisateur et dossiers ----------
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
# Accès au panneau Docker si Docker est installé sur cette machine.
if getent group docker >/dev/null; then usermod -aG docker "$SERVICE_USER"; fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$DATA_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$CONF_DIR"

GENERATED_PASSWORD=""
if [[ ! -f "$ENV_FILE" ]]; then
  password="${SD_ADMIN_PASSWORD:-}"
  if [[ -z "$password" ]]; then
    password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
    GENERATED_PASSWORD="$password"
  fi
  (
    umask 027
    cat > "$ENV_FILE" <<EOF
# Réglages de Server Dashboard. Après modification : systemctl restart $SERVICE
PORT=${SD_PORT:-7575}
ADMIN_PASSWORD=$password
SERVER_NAME=$(hostname)
# true : connexion obligatoire même pour consulter le dashboard
REQUIRE_LOGIN=false
EOF
  )
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

# ---------- Mise en place du code ----------
if $UPDATE; then
  info "Arrêt du service pour la mise à jour"
  systemctl stop "$SERVICE" || true
fi
rm -rf "$APP_DIR.new" "$APP_DIR.old"
cp -a "$TMP/src" "$APP_DIR.new"
echo "$VERSION" > "$APP_DIR.new/VERSION"
chown -R root:root "$APP_DIR.new"
if [[ -d "$APP_DIR" ]]; then mv "$APP_DIR" "$APP_DIR.old"; fi
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"

# ---------- Service systemd ----------
sed "s#@NODE_BIN@#$NODE_BIN#" "$APP_DIR/packaging/server-dashboard.service" > "$UNIT_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

port="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n 1)"
port="${port:-7575}"
info "Démarrage…"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/api/me" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$port/api/me" >/dev/null 2>&1 \
  || fail "le service ne répond pas. Logs : journalctl -u $SERVICE -n 50"

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
if $UPDATE; then
  info "Server Dashboard mis à jour ($VERSION)."
else
  info "Server Dashboard installé ($VERSION)."
fi
echo "    Adresse      : http://${ip:-localhost}:$port"
if [[ -n "$GENERATED_PASSWORD" ]]; then
  echo "    Mot de passe : $GENERATED_PASSWORD   (note-le, il ne sera plus affiché)"
fi
echo "    Réglages     : $ENV_FILE"
echo "    Logs         : journalctl -u $SERVICE -f"
echo "    Mise à jour  : relance cette même commande d'installation"
