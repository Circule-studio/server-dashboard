#!/usr/bin/env bash
# Teste install/server-dashboard-install.sh hors de Proxmox (CI, VM Debian / Ubuntu) : les fonctions
# de community-scripts (build.func / install.func) sont remplacées par des versions simplifiées, et
# le code vient de ce dépôt au lieu de la dernière release GitHub.
#   sudo bash packaging/proxmox/test-install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FUNCTIONS_FILE_PATH="$(cat <<STUBS
set -euo pipefail
STD=""
color() { :; }
verb_ip6() { :; }
catch_errors() { :; }
setting_up_container() { :; }
network_check() { :; }
update_os() { :; }
motd_ssh() { :; }
customize() { :; }
cleanup_lxc() { :; }
msg_info() { echo "… \$*"; }
msg_ok() { echo "✓ \$*"; }
msg_error() { echo "✗ \$*" >&2; }
# Node.js déjà présent dans la CI : on vérifie seulement la version demandée.
setup_nodejs() {
  local major; major="\$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= NODE_VERSION )) || { echo "Node.js \$NODE_VERSION requis (\$major trouvé)" >&2; exit 1; }
}
# Au lieu de télécharger la release : copie du dépôt local, comme le ferait l'archive.
fetch_and_deploy_gh_release() {
  rm -rf "/opt/\$1" && mkdir -p "/opt/\$1"
  tar -C "$ROOT" --exclude=./node_modules --exclude=./data --exclude=./.git -cf - . | tar -C "/opt/\$1" -xf -
}
STUBS
)"
export FUNCTIONS_FILE_PATH
bash "$ROOT/packaging/proxmox/install/server-dashboard-install.sh"
