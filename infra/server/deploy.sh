#!/bin/bash
# Deploys one release on this server. CI runs /opt/app/bin/deploy <sha> over
# SSM Run Command (see infra/cloudformation/environment.yml); that shim unpacks
# the bundle - docker/, static/ and infra/server/ of one commit - and execs this.
#
# Order: render the env file, pull images, migrate as the owner while the old
# release keeps serving, start the new release, and roll back to the previous
# release's images if the api does not turn healthy. Rollback never touches
# the database, so every migration must be safe for the previous release.
set -euo pipefail

sha="$1"
# shellcheck source=/dev/null
. /etc/app.env
release="$(cd "$(dirname "$0")/../.." && pwd)"
current_link=/opt/app/current
previous="$(readlink -f "$current_link" || true)"

log() { echo "deploy[$APP_ENV ${sha:0:7}]: $*"; }

compose_in() {
  docker compose --env-file "$1/apps/api/.env" -f "$1/docker/compose.yml" "${@:2}"
}

# --- 1. apps/api/.env, the only env file, from /app/<env>/ in Parameter Store.
# Values are single-quoted so MAIL_FROM="Orders <orders@x>" stays literal for
# both compose and the shell; a value carrying a quote or newline is refused.
log "rendering env file"
env_file="$release/apps/api/.env"
mkdir -p "$(dirname "$env_file")"
params="$(aws ssm get-parameters-by-path --path "/app/$APP_ENV" --recursive --with-decryption --output json)"
if jq -e --arg q "'" 'any(.Parameters[]; .Value | contains($q) or contains("\n"))' <<<"$params" >/dev/null; then
  log "a /app/$APP_ENV/ parameter contains a single quote or newline; refusing" >&2
  exit 1
fi
(
  umask 077
  jq -r --arg q "'" '.Parameters[] | "\(.Name | split("/") | last)=\($q)\(.Value)\($q)"' <<<"$params"
  echo "API_IMAGE='$REGISTRY/app-api:$sha'"
  echo "WEB_IMAGE='$REGISTRY/app-web:$sha'"
) >"$env_file"
chmod 600 "$env_file"

set -a
# shellcheck source=/dev/null
. "$env_file"
set +a
for name in DOMAIN POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD APP_RUNTIME_PASSWORD; do
  if [ -z "${!name:-}" ]; then
    log "/app/$APP_ENV/$name is not set" >&2
    exit 1
  fi
done
# Both passwords are placed into connection URLs unencoded - compose.yml builds
# DATABASE_URL from APP_RUNTIME_PASSWORD - so keep them URL-safe.
for name in POSTGRES_PASSWORD APP_RUNTIME_PASSWORD; do
  if [[ ! "${!name}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    log "$name must be URL-safe: openssl rand -hex 32" >&2
    exit 1
  fi
done

# --- 2. Images.
log "pulling images"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
compose_in "$release" pull --quiet

# --- 3. Migrations, as the owner. The api and worker never receive this URL;
# compose.yml blanks it for them, and -e passes it to this one container only.
log "applying migrations"
export DATABASE_ADMIN_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB"
compose_in "$release" run --rm -e DATABASE_ADMIN_URL api node scripts/migrate.mjs
unset DATABASE_ADMIN_URL

# --- 4. Start the release and wait for the api's healthcheck (30 s interval).
log "starting release"
compose_in "$release" up -d --no-build --remove-orphans

healthy=false
for _ in $(seq 1 36); do
  api_id="$(compose_in "$release" ps -q api)"
  if [ -n "$api_id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$api_id")" = healthy ]; then
    healthy=true
    break
  fi
  sleep 5
done

worker_id="$(compose_in "$release" ps -q worker)"
if [ "$healthy" = true ] && { [ -z "$worker_id" ] || [ "$(docker inspect -f '{{.State.Running}}' "$worker_id")" != true ]; }; then
  log "worker is not running" >&2
  healthy=false
fi

if [ "$healthy" != true ]; then
  log "release did not turn healthy" >&2
  compose_in "$release" logs --no-color --tail 50 api worker >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$release" ] && [ -f "$previous/apps/api/.env" ]; then
    log "rolling back to $(basename "$previous")" >&2
    compose_in "$previous" up -d --no-build --remove-orphans
  fi
  exit 1
fi

# --- 5. Record the release, keep the last three for rollback, tidy up.
ln -sfn "$release" "$current_link"
"$release/infra/server/install-backup-timer.sh"

find /opt/app/releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
  sort -rn | tail -n +4 | cut -d' ' -f2- |
  while read -r old; do
    [ "$old" = "$release" ] || rm -rf "$old"
  done
docker image prune -af --filter until=168h >/dev/null

log "done"
