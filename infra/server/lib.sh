#!/bin/bash
# Sourced by deploy.sh and backup.sh: the one way to run compose against a
# release - the shared server stack plus this environment's overlay.

# shellcheck source=/dev/null
. /etc/app.env

# compose_in <release-dir> <compose args…>
compose_in() {
  local release="$1"
  shift
  local overlay="$release/docker/compose.$APP_ENV.yml"
  if [ ! -f "$overlay" ]; then
    echo "no compose overlay for '$APP_ENV': $overlay" >&2
    return 1
  fi
  docker compose --env-file "$release/apps/api/.env" \
    -f "$release/docker/compose.yml" -f "$overlay" "$@"
}
