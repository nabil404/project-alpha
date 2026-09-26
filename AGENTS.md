# Messenger-to-Order — Agent Instructions

Turns Facebook/Messenger customer conversations into confirmed orders for
sellers on Facebook Pages. What each MVP builds and why — scope, rules and
domain model — lives in [`docs/mvp/`](docs/mvp/README.md); those docs are the
source of truth. The stack and its principles live in
[`docs/architecture/tech-stack.md`](docs/architecture/tech-stack.md).

Per-app conventions live in `.claude/skills/`: **`backend-engineer`** (`apps/api`
— Drizzle, queue, webhooks, LLM), **`frontend-engineer`** (`apps/web` —
data layer, forms, i18n, Tailwind), **`rest-api-design`** (HTTP surface). Those
are the authority on _how_; this file and the current MVP's docs are the
authority on _what_ and _why_, and win on any conflict.

## MVPs

Full index: [docs/mvp/README.md](docs/mvp/README.md).

### Done

_None yet._

### Current

- [01 · Messenger-to-Order](docs/mvp/01-messenger-to-order/README.md) — Sep 21 –
  Dec 11, 2026. Read its [rules](docs/mvp/01-messenger-to-order/rules.md) before
  any change; they bind every change.

## Commands

| Command                                                            | What it does                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                         | api + web in parallel.                                                                                                                                                                                                                                            |
| `pnpm --filter api dev:worker`                                     | The worker, which `pnpm dev` does not start.                                                                                                                                                                                                                      |
| `pnpm dev:up` / `pnpm dev:down`                                    | Local Postgres, Redis and Mailpit, via compose pointed at `apps/api/.env`.                                                                                                                                                                                        |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | From the root, recursive.                                                                                                                                                                                                                                         |
| `pnpm --filter @app/shared build`                                  | Run after changing a shared schema — `apps/api` tests and typecheck resolve `@app/shared` through its built `dist`, and CI builds it before lint, typecheck and test.                                                                                             |
| `pnpm --filter api db:generate`                                    | Generate a migration from edits to `apps/api/src/database/schema/`. **Review the generated SQL by hand.**                                                                                                                                                         |
| `pnpm --filter api db:migrate`                                     | Apply migrations.                                                                                                                                                                                                                                                 |
| `pnpm --filter api db:verify-rls`                                  | Fails if a table carrying `merchant_id` lacks `ENABLE`/`FORCE` row-level security or a policy. Run after `db:migrate`; CI runs it too, because drizzle-kit generates `ENABLE` and the policy but not `FORCE`, so nothing else would catch a half-protected table. |
| `pnpm --filter api db:custom`                                      | An empty migration for DDL drizzle-kit does not model: `FORCE ROW LEVEL SECURITY`, roles, grants, default privileges, functions, triggers.                                                                                                                        |
| `pnpm --filter api db:auth-schema`                                 | Regenerate Better Auth SQL, then paste `src/database/schema/auth.ts`, then `db:generate` to migrate it.                                                                                                                                                           |

**Schema loop:** edit `apps/api/src/database/schema/` → `db:generate` → review
the SQL by hand → `db:migrate` → `db:verify-rls`.

| Local URL (dev only)           | What                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| http://localhost:8025          | Mailpit, started by `pnpm dev:up`. The dev `SMTP_URL` is `smtp://localhost:1025`; verification and password-reset emails land here.                                                                                                                                                                                                                                 |
| http://localhost:5173/api/docs | Swagger UI (JSON at `/api/docs/openapi.json`): our controllers plus Better Auth's routes, built at boot by `apps/api/src/openapi/openapi.ts`, not mounted when `NODE_ENV=production`. Open it through the Vite proxy, not the API's own port: Better Auth trusts only `APP_URL`, so "Try it out" from `localhost:3000` fails every auth call with `INVALID_ORIGIN`. |

- **Two database URLs.** `DATABASE_URL` is the app's restricted, non-superuser
  connection (`app_runtime`), so row-level security applies to it.
  `DATABASE_ADMIN_URL` is the owner and is used only by schema tooling —
  `db:generate`, `db:migrate`, `db:verify-rls`, and the CI deploy step. The api
  and worker must
  never receive the admin URL; it is deliberately absent from `env.schema.ts`.
- **One env file.** `apps/api/.env` is the only one, for the app and both
  compose stacks alike. Compose must be pointed at it — `docker compose
--env-file apps/api/.env -f docker/compose.yml …`, wrapped as `pnpm dev:up` /
  `pnpm dev:down` for local dependencies — because on its own it would look for
  `docker/.env`, which no longer exists. The file is written for host
  development, so `docker/compose.yml` overrides `DATABASE_URL`, `REDIS_URL` and
  `APP_URL` with service hostnames and blanks `DATABASE_ADMIN_URL` and the
  `POSTGRES_*` secrets for the api and worker. A new app variable needs no
  compose change; a new one that must differ inside containers belongs in the
  `x-app-env` anchor.
- **Test runners.** `apps/web` and `packages/shared` have none yet; `apps/api`
  Jest runs as ESM (`--experimental-vm-modules`), configured in
  `apps/api/jest.config.mjs`.

## Conventions for Claude Code

- Commit messages: no co-author trailers.
- drizzle-kit is the only tool that changes the database schema; never
  hand-edit a _generated_ migration, never apply DDL directly, and never run
  `drizzle-kit push`. For DDL drizzle-kit does not model (`FORCE` row-level
  security, roles, grants, default privileges, functions, triggers), author it
  with `pnpm --filter api db:custom` — drizzle-kit still owns ordering and
  apply.
- Never log tokens, secrets, or raw Page access tokens.
- Every API route needs a signed-in session: `SessionGuard` is global. A route
  that must stay public (health, Meta webhooks) says so with `@AllowAnonymous()`
  from `@thallesp/nestjs-better-auth`; Better Auth itself is mounted at
  `/api/v1/auth/*` by `apps/api/src/auth/auth.module.ts`.
- Errors leave the API as the coded envelope `{ error: { code, message, params } }`.
  Throw a `Coded*Exception` from `apps/api/src/common/errors/`, never a bare NestJS
  exception; the contract is in
  `.claude/skills/rest-api-design/references/response-formats.md`.
- Every relative import ends in `.js` (`"type": "module"` on NodeNext), including
  inside specs and when the file on disk is `.ts`.
- Adding a member to a `@app/shared` enum is a three-file change. A new
  `ErrorCode` in `packages/shared/src/errors/codes.ts` also needs an entry in
  `apps/web/src/i18n/error-keys.ts` and a string in
  `apps/web/src/i18n/locales/en/errors.json`; likewise for order statuses,
  conversation states and stock statuses against `status-keys.ts` and
  `common.json`. The maps are `satisfies Record<Enum, ParseKeys<ns>>`, so a
  missing entry fails `pnpm --filter web typecheck`, not runtime.
- No user-facing string is hardcoded in `apps/web` JSX — copy resolves through
  `t()`, money and dates through `useFormatters()` in `src/lib/format.ts`, which
  delegates to `formatMinorUnits` from `@app/shared`. `packages/shared` must
  never import i18next; the locale crosses that boundary as a BCP-47 string.
- Tests live in a colocated `__tests__/` directory, never as a sibling file.
  This applies to both apps.
- Project instructions live in `AGENTS.md` only. Do not create `CLAUDE.md` or
  `CLAUDE.local.md`; either one stops Claude Code from loading this file.
