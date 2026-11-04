#!/usr/bin/env bash
# Installe ou met à jour l'agent Server Dashboard en service systemd : Node.js si besoin (Debian, Ubuntu),
# script de l'agent, et service lancé sans droits. La commande exacte, avec l'identifiant et le jeton,
# est donnée par le dashboard : mode édition, widget « Agent ».
#
#   curl -fsSL http://IP:7575/agent/install.sh | sudo env DASHBOARD_URL=… AGENT_ID=… AGENT_TOKEN=… bash
#
# Relancer la même commande met à jour l'agent. Désinstaller (Node.js reste) :
#   curl -fsSL http://IP:7575/agent/install.sh | sudo bash -s -- --uninstall
#
# Variables facultatives :
#   AGENT_DOCKER=0       ne pas donner au service l'accès à Docker (donné si le groupe docker existe)
#   AGENT_APT_REFRESH=0  ne pas activer le rafraîchissement quotidien des listes de paquets
set -euo pipefail

APP_DIR="/opt/server-dashboard-agent"
ENV_FILE="/etc/server-dashboard-agent.env"
SERVICE="server-dashboard-agent"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
APT_FILE="/etc/apt/apt.conf.d/20server-dashboard"
NODE_MAJOR=22

export LC_ALL=C.UTF-8 LANG=C.UTF-8

die() { echo "Erreur : $*" >&2; exit 1; }
info() { echo "==> $*"; }

# fetch (Node 18) et fs.statfsSync (Node 18.15), comme l'agent.
node_ok() {
  command -v node >/dev/null && node -e 'process.exit(typeof fetch === "function" && typeof require("fs").statfsSync === "function" ? 0 : 1)' 2>/dev/null
}

uninstall() {
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT_FILE" "$ENV_FILE" "$APT_FILE"
  rm -rf "$APP_DIR"
  systemctl daemon-reload
  info "Agent désinstallé. Node.js reste installé."
}

install_dependencies() {
  node_ok && command -v curl >/dev/null && return 0
  command -v apt-get >/dev/null || die "installe curl et Node.js 18.15 ou plus récent, puis relance la commande."
  info "Paquets de base"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq </dev/null
  apt-get install -y -qq curl ca-certificates gnupg </dev/null >/dev/null
  node_ok && return 0
  info "Installation de Node.js $NODE_MAJOR (dépôt NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq </dev/null
  apt-get install -y -qq nodejs </dev/null >/dev/null
}

main() {
  (( EUID == 0 )) || die "à lancer en root : ajoute sudo devant bash, ou devant env."
  command -v systemctl >/dev/null || die "systemd est nécessaire. Sans lui, lance l'agent à la main : voir agent/README.md."
  if [[ "${1:-}" == "--uninstall" ]]; then
    uninstall
    return
  fi

  local url="${DASHBOARD_URL:-}" id="${AGENT_ID:-}" token="${AGENT_TOKEN:-}"
  [[ -n "$url" && -n "$id" && -n "$token" ]] || die "DASHBOARD_URL, AGENT_ID et AGENT_TOKEN sont obligatoires (commande donnée par le dashboard)."
  # Ces valeurs vont dans un fichier lu par systemd : rien d'autre qu'une adresse et des identifiants.
  local url_re='^https?://[]A-Za-z0-9.:_/[-]+$' # ] en tête : dans [...], la barre oblique inverse ne l'échappe pas
  [[ "$url" =~ $url_re ]] || die "DASHBOARD_URL invalide : $url"
  [[ "$id$token" =~ ^[A-Za-z0-9._-]+$ ]] || die "AGENT_ID ou AGENT_TOKEN invalide : recopie la commande donnée par le dashboard."
  url="${url%/}"

  install_dependencies
  local node_bin
  node_bin="$(command -v node)"
  info "Node.js $(node -v)"

  info "Script de l'agent"
  install -d -m 0755 "$APP_DIR"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL "$url/agent/server-dashboard-agent.js" -o "$tmp" || die "dashboard injoignable à $url"
  install -m 0644 "$tmp" "$APP_DIR/server-dashboard-agent.js"
  rm -f "$tmp"

  # Le jeton reste dans un fichier lisible par root seul, lu par systemd au démarrage du service.
  (umask 077 && printf 'DASHBOARD_URL=%s\nAGENT_ID=%s\nAGENT_TOKEN=%s\n' "$url" "$id" "$token" > "$ENV_FILE")

  # Lire le socket de Docker revient à un accès complet à Docker : AGENT_DOCKER=0 pour s'en passer.
  local docker_line=""
  if [[ "${AGENT_DOCKER:-1}" != "0" ]] && getent group docker >/dev/null; then
    docker_line="SupplementaryGroups=docker"
    info "Accès à Docker donné à l'agent, pour vérifier les images (AGENT_DOCKER=0 pour l'éviter)"
  fi

  cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=Agent Server Dashboard
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$node_bin $APP_DIR/server-dashboard-agent.js
DynamicUser=true
$docker_line
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

  # Sinon le décompte des mises à jour vieillit avec les listes. Rafraîchir les listes n'installe rien.
  if [[ "${AGENT_APT_REFRESH:-1}" != "0" ]] && command -v apt-config >/dev/null && ! apt-config dump | grep -q Update-Package-Lists; then
    echo 'APT::Periodic::Update-Package-Lists "1";' > "$APT_FILE"
    info "Rafraîchissement quotidien des listes de paquets activé (rien n'est installé)"
  fi

  systemctl daemon-reload
  systemctl enable -q "$SERVICE"
  systemctl restart "$SERVICE"
  sleep 3
  if ! systemctl is-active -q "$SERVICE"; then
    journalctl -u "$SERVICE" -n 15 --no-pager >&2 || true
    die "le service ne démarre pas (journal ci-dessus)."
  fi
  info "Agent actif : la machine apparaît sur le dashboard dans quelques secondes."
}

# Tout le script est lu avant de démarrer : une commande qui lirait l'entrée (curl | bash) ne le coupe pas.
main "$@"
