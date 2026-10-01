#!/bin/bash
# Deploys one commit on this server. CI runs /opt/app/bin/deploy <sha> over SSM
# Run Command (see infra/cloudformation/environment.yml); that shim unpacks the
# commit's bundle - docker/, static/ and infra/server/ - into /opt/app and runs
# this.
#
# Migrations run while the previous release still serves. If the new release
# does not turn healthy, its images are swapped back for the previous ones;
# the database is never rolled back, so every migration must be safe for the
# previous release.
set -euo pipefail

sha="$1"
# shellcheck source=infra/server/lib.sh
. /opt/app/infra/server/lib.sh
previous="$(cat /opt/app/deployed 2>/dev/null || true)"

log() { echo "deploy[$APP_ENV ${sha:0:7}]: $*"; }

# The whole env file is one SecureString, written as it is. Compose validates
# what the stack needs; the app validates the rest at boot.
log "writing env file"
mkdir -p /opt/app/apps/api
(
  umask 077
  aws ssm get-parameter --name "/social-glider/$APP_ENV/env" --with-decryption \
    --query Parameter.Value --output text
  echo "API_IMAGE=$REGISTRY/$API_REPOSITORY:$sha"
  echo "WEB_IMAGE=$REGISTRY/$WEB_REPOSITORY:$sha"
) >"$ENV_FILE"

log "pulling images"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
app_compose pull --quiet

log "applying migrations"
app_compose run --rm migrate

log "starting release"
if ! app_compose up -d --remove-orphans --wait --wait-timeout 180; then
  log "release did not turn healthy" >&2
  app_compose logs --no-color --tail 50 api worker caddy >&2 || true
  if [ -n "$previous" ]; then
    log "rolling back to ${previous:0:7}" >&2
    # The shell beats the env file for interpolation, so this starts the
    # previous images under the current compose files.
    API_IMAGE="$REGISTRY/$API_REPOSITORY:$previous" \
      WEB_IMAGE="$REGISTRY/$WEB_REPOSITORY:$previous" \
      app_compose up -d --remove-orphans
  fi
  exit 1
fi

echo "$sha" >/opt/app/deployed
docker image prune -af --filter until=168h >/dev/null
log "done"
