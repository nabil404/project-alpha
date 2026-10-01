#!/bin/bash
# Nightly logical backup of the database to S3, run by app-backup.timer (set up
# at first boot by infra/cloudformation/environment.yml).
set -euo pipefail

# shellcheck source=infra/server/lib.sh
. /opt/app/infra/server/lib.sh
key="$APP_ENV/$(date -u +%Y-%m-%dT%H%M%SZ).dump"

# pg_dump reads the user and database from the postgres container's own env.
# shellcheck disable=SC2016
app_compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
  aws s3 cp - "s3://$BACKUPS_BUCKET/$key"

echo "backup: s3://$BACKUPS_BUCKET/$key"
