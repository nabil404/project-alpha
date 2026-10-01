#!/bin/bash
# Nightly logical backup of the current release's database to S3. Run by
# app-backup.timer, which install-backup-timer.sh points at /opt/app/current.
set -euo pipefail

release=/opt/app/current
# shellcheck source=infra/server/lib.sh
. "$release/infra/server/lib.sh"
key="$APP_ENV/$(date -u +%Y-%m-%dT%H%M%SZ).dump"

# pg_dump reads the user and database from the postgres container's own env.
# shellcheck disable=SC2016
compose_in "$release" \
  exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
  aws s3 cp - "s3://$BACKUPS_BUCKET/$key"

echo "backup: s3://$BACKUPS_BUCKET/$key"
