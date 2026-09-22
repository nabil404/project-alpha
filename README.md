# Messenger-to-Order

Turns Facebook/Messenger conversations into confirmed orders. Project context,
non-negotiable rules, and database rules live in [CLAUDE.md](./CLAUDE.md).

## Layout

```
apps/api         NestJS API + worker (one codebase), Atlas schema in db/
apps/web         React SPA (Vite, TanStack Router/Query, Tailwind, shadcn/ui)
packages/shared  Zod schemas shared by API input, forms, and LLM output
docker/          Compose stacks and the Caddyfile
static/          Privacy policy, terms, data deletion (Meta App Review)
```

## Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then fill in the secrets
docker compose -f docker/compose.dev.yml up -d
pnpm --filter @app/shared build
pnpm --filter api db:apply                  # Atlas applies migrations
pnpm --filter api db:types                  # kysely-codegen regenerates types
pnpm dev                                    # api on :3000, web on :5173
```

Webhooks need a public HTTPS URL: `cloudflared tunnel --url http://localhost:3000`.

## Database changes

Atlas is the only tool that changes the schema.

```bash
# 1. edit apps/api/db/schema.sql
pnpm --filter api db:diff -- add_orders   # generate a migration
pnpm --filter api db:lint                 # lint it, then review it by hand
pnpm --filter api db:apply                # apply
pnpm --filter api db:types                # regenerate database.types.ts, commit it
```

CI applies every migration to a fresh Postgres, reruns codegen, and fails on
type drift.

## Environments

- **local** — dependencies in `docker/compose.dev.yml`, apps on the host.
- **staging** — `docker compose -p app-staging --env-file .env.staging -f docker/compose.yml up -d`
- **production** — `docker/compose.yml` on the VPS, deployed by CI over SSH.
