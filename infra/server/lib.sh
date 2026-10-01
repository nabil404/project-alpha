#!/bin/bash
# Sourced by deploy.sh and backup.sh: the one way to run compose on a server -
# the shared stack plus this environment's overlay, with /opt/app/apps/api/.env.

# shellcheck source=/dev/null
. /etc/app.env

ENV_FILE=/opt/app/apps/api/.env

app_compose() {
  docker compose --env-file "$ENV_FILE" \
    -f /opt/app/docker/compose.yml -f "/opt/app/docker/compose.$APP_ENV.yml" "$@"
}
