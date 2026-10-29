#!/usr/bin/env bash
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: Circule-studio
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/Circule-studio/server-dashboard

APP="Server-Dashboard"
var_tags="${var_tags:-dashboard}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-512}"
var_disk="${var_disk:-2}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -f /opt/server-dashboard/server.js ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  NODE_VERSION="22" setup_nodejs

  if check_for_gh_release "server-dashboard" "Circule-studio/server-dashboard"; then
    msg_info "Stopping service"
    systemctl stop server-dashboard
    msg_ok "Stopped service"

    # Config et données sont hors de /opt/server-dashboard : le code peut être remplacé entièrement.
    CLEAN_INSTALL=1 fetch_and_deploy_gh_release "server-dashboard" "Circule-studio/server-dashboard" "tarball"

    msg_info "Updating ${APP}"
    cd /opt/server-dashboard || exit
    $STD npm ci --omit=dev --no-audit --no-fund
    msg_ok "Updated ${APP}"

    msg_info "Starting service"
    systemctl start server-dashboard
    msg_ok "Started service"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL:${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:7575${CL}"
echo -e "${INFO}${YW}Admin password: cat ~/server-dashboard.creds (inside the container)${CL}"
