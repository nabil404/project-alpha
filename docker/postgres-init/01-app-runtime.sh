#!/bin/sh
# Creates the restricted login role the api and worker connect as. Postgres
# runs this only on a fresh data directory. On an older cluster, the
# rls_runtime_role migration creates the role NOLOGIN and an operator sets its
# password by hand (see apps/api/.env.example). Grants belong to the migration.
set -eu

if [ -z "${APP_RUNTIME_PASSWORD:-}" ]; then
  echo "app-runtime: APP_RUNTIME_PASSWORD unset - skipping. The api will not be" >&2
  echo "app-runtime: able to connect until the role is given a password." >&2
  exit 0
fi

# :'pw' makes psql quote the password as a literal, so it is never concatenated
# into the statement text.
psql -v ON_ERROR_STOP=1 -v pw="$APP_RUNTIME_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  PASSWORD :'pw';
EOSQL

echo "app-runtime: role created."
