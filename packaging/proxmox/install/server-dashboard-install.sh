#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: Circule-studio
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/Circule-studio/server-dashboard

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

NODE_VERSION="22" setup_nodejs
fetch_and_deploy_gh_release "server-dashboard" "Circule-studio/server-dashboard" "tarball"

msg_info "Installing Server Dashboard"
cd /opt/server-dashboard || exit
$STD npm ci --omit=dev --no-audit --no-fund
# Mêmes emplacements que packaging/install.sh : config et données hors du dossier du code.
useradd --system --home-dir /var/lib/server-dashboard --shell /usr/sbin/nologin server-dashboard
install -d -o server-dashboard -g server-dashboard -m 0750 /var/lib/server-dashboard
install -d -o root -g server-dashboard -m 0750 /etc/server-dashboard
ADMIN_PASS=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)
cat <<EOF2 >/etc/server-dashboard/server-dashboard.env
# Réglages de Server Dashboard. Après modification : systemctl restart server-dashboard
PORT=7575
ADMIN_PASSWORD=${ADMIN_PASS}
SERVER_NAME=$(hostname)
# true : connexion obligatoire même pour consulter le dashboard
REQUIRE_LOGIN=false
EOF2
chown root:server-dashboard /etc/server-dashboard/server-dashboard.env
chmod 0640 /etc/server-dashboard/server-dashboard.env
{
  echo "Server Dashboard"
  echo "Admin password: ${ADMIN_PASS}"
  echo "Settings: /etc/server-dashboard/server-dashboard.env"
} >>~/server-dashboard.creds
msg_ok "Installed Server Dashboard"

msg_info "Creating service"
cat <<EOF2 >/etc/systemd/system/server-dashboard.service
[Unit]
Description=Server Dashboard
Documentation=https://github.com/Circule-studio/server-dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=server-dashboard
Group=server-dashboard
WorkingDirectory=/opt/server-dashboard
Environment=NODE_ENV=production
Environment=DATA_DIR=/var/lib/server-dashboard
EnvironmentFile=/etc/server-dashboard/server-dashboard.env
ExecStart=$(command -v node) /opt/server-dashboard/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF2
systemctl enable -q --now server-dashboard
msg_ok "Created service"

motd_ssh
customize
cleanup_lxc
