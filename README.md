# Messenger-to-Order

Turns Facebook/Messenger conversations into confirmed orders. Project context,
non-negotiable rules, and database rules live in [AGENTS.md](./AGENTS.md).

## Layout

```
apps/api         NestJS API + worker (one codebase), Drizzle schema in src/database/schema/
apps/web         React SPA (Vite, TanStack Router/Query, Tailwind, shadcn/ui)
packages/shared  Zod schemas shared by API input, forms, and LLM output
docker/          Compose stacks and the Caddyfile
static/          Privacy policy, terms, data deletion (Meta App Review)
```

## Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then fill in the secrets
pnpm dev:up                                 # Postgres and Redis
pnpm --filter @app/shared build
pnpm --filter api db:migrate                # apply migrations
pnpm dev                                    # api on :3000, web on :5173
```

`apps/api/.env` is the only env file in the repo: the api and worker read it
through `@nestjs/config`, the schema tooling loads it for `DATABASE_ADMIN_URL`,
and the compose stacks interpolate it for `DOMAIN` and the Postgres
credentials. Compose has to be pointed at it, since it would otherwise look for
`docker/.env` — that is all `pnpm dev:up` / `pnpm dev:down` do:

```bash
docker compose --env-file apps/api/.env -f docker/compose.dev.yml up -d
```

The file is written for host development. For the containers,
`docker/compose.app.yml` rebuilds `DATABASE_URL`, `REDIS_URL` and `APP_URL` from
the stack variables, and blanks `DATABASE_ADMIN_URL`, `REDIS_PASSWORD` and the
Postgres secrets so the api and worker never receive them.

Webhooks need a public HTTPS URL: `cloudflared tunnel --url http://localhost:3000`.

## Database changes

drizzle-kit is the only tool that changes the schema. `drizzle-kit push` is never
used: every change ships as a reviewed migration.

```bash
# 1. edit apps/api/src/database/schema/
pnpm --filter api db:generate --name add_orders   # generate a migration
#    review the generated SQL by hand
pnpm --filter api db:migrate                      # apply
pnpm --filter api db:verify-rls                   # every tenant table protected?
```

Types are inferred from the schema, so there is nothing to regenerate and no
database is needed to typecheck. drizzle-kit diffs against the JSON snapshots in
`db/migrations/meta`, so generating a migration needs no shadow database either —
commit the snapshot alongside the migration. CI applies every migration to a
fresh Postgres and fails if a schema change arrived without one.

Some DDL is not modelled by drizzle-kit — `FORCE ROW LEVEL SECURITY`, roles,
grants, default privileges, functions, triggers. Author those with
`pnpm --filter api db:custom`, which creates an empty migration for hand-written
SQL. `db:verify-rls` exists because of the first one: drizzle-kit emits `ENABLE`
and the policy but not `FORCE`, so a table can look protected and not be.

Better Auth owns the `user`, `session`, `account`, `verification` and
organization tables. Regenerate them with `pnpm --filter api db:auth-schema`,
which overwrites `src/database/schema/auth.ts` — never edit it by hand. They then
migrate through the same pipeline as everything else.

The api and worker connect as `app_runtime`, a non-superuser role, so row-level
security applies to them; a superuser bypasses every policy unconditionally.
Schema tooling connects as the owner through `DATABASE_ADMIN_URL`.

## Environments

- **local** — dependencies in `docker/compose.dev.yml`, apps on the host.
- **staging** — `docker compose -p app-staging --env-file apps/api/.env.staging -f docker/compose.yml up -d`
- **production** — `docker/compose.yml` on the VPS, deployed by CI over SSH. It
  includes one compose file per role (web, api, worker, data), so a role can
  move to its own server later — see [docs/deployment.md](docs/deployment.md).
