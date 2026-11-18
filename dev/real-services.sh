#!/usr/bin/env bash
# Lance les vrais Loki, Authelia et Watchtower avec Docker, puis les interroge avec nos intégrations
# (dev/check-real-services.js). Utilisé par la CI ; rien n'est exposé en dehors de cette machine : les ports
# ne sont ouverts que sur 127.0.0.1, et conteneurs comme config sont supprimés à la fin, même en échec (#177).
set -euo pipefail

CONTAINERS=(sd-loki sd-authelia sd-watchtower)

LOKI_IMAGE="grafana/loki:3.5.1"
AUTHELIA_IMAGE="authelia/authelia:4.39"
WATCHTOWER_IMAGE="containrrr/watchtower:1.7.1"

config="$(mktemp -d)"
cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    for c in "${CONTAINERS[@]}"; do echo "=== $c"; docker logs --tail 40 "$c" 2>&1 || true; done
  fi
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true
  rm -rf -- "$config"
  exit "$status"
}
trap cleanup EXIT
# Restes d'un lancement interrompu (noms fixes) : sinon « Conflict » au premier docker run.
docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1 || true

hash="$(docker run --rm "$AUTHELIA_IMAGE" authelia crypto hash generate argon2 --password ci-pass | sed -n 's/^Digest: //p')"
cat > "$config/users.yml" <<USERS
users:
  ci:
    disabled: false
    displayname: CI
    password: '$hash'
    email: ci@example.com
USERS
cat > "$config/configuration.yml" <<'CONFIG'
server:
  address: 'tcp://:9091'
telemetry:
  metrics:
    enabled: true
    address: 'tcp://:9959'
identity_validation:
  reset_password:
    jwt_secret: 'secret-de-test-pour-la-ci-seulement-0123456789'
authentication_backend:
  file:
    path: /config/users.yml
access_control:
  default_policy: one_factor
session:
  secret: 'secret-de-test-pour-la-ci-seulement-0123456789'
  cookies:
    - domain: example.com
      authelia_url: https://auth.example.com
storage:
  encryption_key: 'secret-de-test-pour-la-ci-seulement-0123456789'
  local:
    path: /config/db.sqlite3
notifier:
  filesystem:
    filename: /config/notifications.txt
CONFIG

docker run -d --name sd-loki -p 127.0.0.1:3100:3100 "$LOKI_IMAGE"
# PUID/PGID : Authelia écrit dans $config sous notre utilisateur, pas root, pour qu'on puisse le supprimer à la fin.
docker run -d --name sd-authelia -p 127.0.0.1:9091:9091 -p 127.0.0.1:9959:9959 -v "$config:/config" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" "$AUTHELIA_IMAGE"
# Watchtower n'est plus maintenu : son client Docker est trop ancien pour la version de l'API par défaut.
docker run -d --name sd-watchtower -p 127.0.0.1:8080:8080 -v /var/run/docker.sock:/var/run/docker.sock \
  -e DOCKER_API_VERSION=1.44 -e WATCHTOWER_HTTP_API_METRICS=true -e WATCHTOWER_HTTP_API_TOKEN=ci-token \
  -e WATCHTOWER_HTTP_API_PERIODIC_POLLS=true -e WATCHTOWER_MONITOR_ONLY=true -e WATCHTOWER_POLL_INTERVAL=5 "$WATCHTOWER_IMAGE"

node dev/check-real-services.js
