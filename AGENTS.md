# Social Glider agent instructions

Social Glider turns Facebook Messenger customer conversations into confirmed
orders for sellers on Facebook Pages.

These docs say what to build and how it works:

- [`docs/mvp/`](docs/mvp/README.md) says what each MVP builds and why, with
  its scope, rules and domain model. Those docs are the source of truth.
- [`docs/architecture/tech-stack.md`](docs/architecture/tech-stack.md) covers
  the stack and its principles.
- [`docs/architecture/ai.md`](docs/architecture/ai.md) covers how the
  assistant uses the LLM, with its calls, system prompts, output schemas and
  each entry point's path. Update it in the same change as a prompt, schema or
  turn path.
- [`docs/features/`](docs/features/README.md) covers how each built feature
  works, with its routes, rules, data, tests and what is left. Update a
  feature's page in the same change as its code, and grep the other pages for
  "Not yet built" and follow-up entries the change completes.

Per-app conventions live in `.claude/skills/`:

- `backend-engineer` covers `apps/api`, including Drizzle, the queue, webhooks
  and the LLM.
- `frontend-engineer` covers `apps/web`, including the data layer, forms, i18n
  and Tailwind.
- `rest-api-design` covers the HTTP API.
- `docs-sync` checks that a change updated every doc it affects, then fixes
  the gaps. Run it before a commit or PR.

The skills are the authority on _how_. This file and the current MVP's docs
are the authority on _what_ and _why_, and win on any conflict.

## MVPs

Full index: [docs/mvp/README.md](docs/mvp/README.md).

### Done

_None yet._

### Current

- [01 · Messenger-to-Order](docs/mvp/01-messenger-to-order/README.md) runs from
  Sep 21 to Dec 11, 2026. Read its [rules](docs/mvp/01-messenger-to-order/rules.md)
  before any change. Every change must follow them.

## Commands

| Command                                                            | What it does                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                                         | Runs the api and web in parallel. The api's `dev` and `dev:worker` build `@app/shared` first, so a fresh start picks up shared changes.                                                                                                                                                                                                                            |
| `pnpm --filter api dev:worker`                                     | Runs the worker, which `pnpm dev` does not start.                                                                                                                                                                                                                                                                                                                  |
| `pnpm dev:up` / `pnpm dev:down`                                    | Starts or stops local Postgres, Redis and Mailpit with compose, pointed at `environments/.env`.                                                                                                                                                                                                                                                                    |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Run from the root. Each one runs in every package.                                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @app/shared build`                                  | Run after changing a shared schema while the api is already running, or before `apps/api` tests and typecheck. Those resolve `@app/shared` through its built `dist`, and CI builds it before lint, typecheck and test.                                                                                                                                             |
| `pnpm --filter api db:generate`                                    | Generate a migration from edits to `apps/api/src/modules/database/schema/`. **Review the generated SQL by hand.**                                                                                                                                                                                                                                                  |
| `pnpm --filter api db:migrate`                                     | Apply migrations.                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm --filter api db:verify-rls`                                  | Fails if a table carrying `merchant_id` lacks `ENABLE`/`FORCE` row-level security or a policy. Run it after `db:migrate`. CI runs it too, because drizzle-kit generates `ENABLE` and the policy but not `FORCE`, so nothing else would catch a half-protected table.                                                                                               |
| `pnpm --filter api db:seed-products`                               | Fill a local shop's catalog with about 20 hand-written products. `--count <n>` adds generated ones, `--reset` clears the shop's first, and `--org <slug>` picks the shop. Use it only in development, on a local database. See [`docs/features/02-catalog`](docs/features/02-catalog/README.md#dev-seed).                                                          |
| `pnpm --filter api db:custom`                                      | Creates an empty migration for DDL drizzle-kit does not model: `FORCE ROW LEVEL SECURITY`, roles, grants, default privileges, functions, triggers.                                                                                                                                                                                                                 |
| `pnpm --filter api db:auth-schema`                                 | Regenerate Better Auth SQL, then paste `src/modules/database/schema/auth.ts`, then `db:generate` to migrate it.                                                                                                                                                                                                                                                    |
| `pnpm --filter api load <test>`                                    | Run a k6 load test from `apps/api/load/tests/` (no argument lists them) against a local api. It needs `k6` installed. See [`apps/api/load/README.md`](apps/api/load/README.md).                                                                                                                                                                                    |
| `infra/cloudformation/deploy.sh <target>`                          | Create or update a CloudFormation stack. `<target>` is `bootstrap` (shared by dev and stage, first), `bootstrap-prod` (prod's own copy, before prod), or one of the environments `dev`, `stage` and `prod`, read from `environments/<env>.params`. It needs AWS CLI v2 and `AWS_REGION`. See [`docs/architecture/deployment.md`](docs/architecture/deployment.md). |

**Schema loop.** Edit `apps/api/src/modules/database/schema/`, run
`db:generate`, review the SQL by hand, then run `db:migrate` and
`db:verify-rls`. Migrations land in `apps/api/db/migrations/` as
`NNNN_name.sql`, with snapshots in `meta/`.

| Local URL (dev only)               | What                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <http://localhost:8025>            | Mailpit, started by `pnpm dev:up`. The dev `SMTP_URL` is `smtp://localhost:1025`, and verification and password-reset emails land here.                                                                                                                                                                                                                                                        |
| <http://localhost:5173/api/docs>   | Swagger UI for our controllers and Better Auth's routes, with the JSON at `/api/docs/openapi.json`. `apps/api/src/openapi/openapi.ts` builds it at boot, and the api mounts it only when `NODE_ENV=development`. Open it through the Vite proxy, not the API's own port. Better Auth trusts only `APP_URL`, so "Try it out" from `localhost:3000` fails every auth call with `INVALID_ORIGIN`. |
| <http://localhost:5173/api/queues> | Bull Board for every BullMQ queue. `apps/api/src/modules/queue/queue-board.ts` mounts it only when `NODE_ENV=development`. It bypasses `SessionGuard` and shows every seller's job payloads, so never mount it outside development.                                                                                                                                                            |
| <http://localhost:5173/privacy>    | The legal pages Meta requires, also at `/terms` and `/data-deletion`. A dev-only plugin in `apps/web/vite.config.ts` serves them from `static/`, mirroring `docker/Caddyfile`.                                                                                                                                                                                                                 |

- **Two database URLs.** `DATABASE_URL` is the app's restricted, non-superuser
  connection (`app_runtime`), so row-level security applies to it.
  `DATABASE_ADMIN_URL` is the owner. Only `db:generate`, `db:migrate`,
  `db:verify-rls` and the CI deploy step use it. The api and worker must never
  receive the admin URL, so `env.schema.ts` leaves it out on purpose.
- **Object storage.** Product images live in Cloudflare R2. The app reaches
  R2 only through the S3 API with the `STORAGE_*` variables. Development uses
  its own bucket and token. Never point a local `.env` at the production
  bucket.
- **One env file.** `environments/.env` is the only env file, for the app and
  every compose file. On a server, `infra/server/deploy.sh` renders it from
  Parameter Store. Point compose at it with
  `docker compose --env-file environments/.env -f docker/compose.local.yml …`,
  which `pnpm dev:up` and `pnpm dev:down` wrap. Without `--env-file`, compose
  looks for `docker/.env`, which no longer exists.
- **Compose files.** `docker/compose.local.yml` is local dependencies only.
  `docker/compose.yml` is the server stack shared by dev, stage and prod, and
  never runs alone. Each server adds its overlay, `docker/compose.<env>.yml`,
  which holds only container sizing matched to that environment's instance
  type in `infra/cloudformation/environments/<env>.params`. The env file
  targets host development, so `docker/compose.yml` overrides `DATABASE_URL`, `REDIS_URL` and
  `APP_URL` with service hostnames and blanks `DATABASE_ADMIN_URL` and the
  `POSTGRES_*` secrets for the api and worker. A new app variable needs no
  compose change. A new one that must differ inside containers belongs in the
  `x-app-env` anchor.
- **Test runners.** `apps/web` and `packages/shared` have none yet. `apps/api`
  Jest runs as ESM (`--experimental-vm-modules`), configured in
  `apps/api/jest.config.mjs`.
- **Test database.** Specs never use `DATABASE_URL`, `DATABASE_ADMIN_URL` or
  `REDIS_URL`. They read `TEST_DATABASE_ADMIN_URL` and `TEST_REDIS_URL` through
  `apps/api/src/__tests__/test-env.ts` (`describeDb`, `testDatabaseUrl`, …).
  `apps/api/jest.global-setup.mjs` copies only those keys from
  `environments/.env`, refuses a database whose name does not end in `_test`,
  creates it if it is missing and migrates it before every run. When the keys
  are unset, Jest skips the specs that need the database or Redis, and a
  skipped suite is not a pass.

## Conventions for Claude Code

- Commit messages carry no co-author trailers.
- drizzle-kit is the only tool that changes the database schema. Never
  hand-edit a _generated_ migration, never apply DDL directly, and never run
  `drizzle-kit push`. For DDL drizzle-kit does not model (`FORCE` row-level
  security, roles, grants, default privileges, functions, triggers), author it
  with `pnpm --filter api db:custom`. drizzle-kit still orders and applies it.
- Never log tokens, secrets, or raw Page access tokens.
- Every API route needs a signed-in session, because `SessionGuard` is global.
  A route that must stay public (health, Meta webhooks) says so with
  `@AllowAnonymous()` from `@thallesp/nestjs-better-auth`.
  `apps/api/src/modules/auth/auth.module.ts` mounts Better Auth itself at
  `/api/v1/auth/*`.
- Errors leave the API as the coded envelope `{ error: { code, message, params } }`.
  Throw a `Coded*Exception` from `apps/api/src/common/errors/`, never a bare NestJS
  exception. The contract is in
  `.claude/skills/rest-api-design/references/response-formats.md`.
- Relative imports carry no file extension. Write `./foo`, never `./foo.js`
  or `./foo.ts`, in specs too. `no-restricted-imports` in `eslint.config.js`
  enforces it. `apps/api` resolves with `moduleResolution: Bundler` and builds
  with SWC (`.swcrc`, `resolveFully`), which writes the `.js` Node's ESM loader
  needs into `dist`. `nest build` still type-checks.
- Adding a member to a `@app/shared` enum is a three-file change. A new
  `ErrorCode` in `packages/shared/src/errors/codes.ts` also needs an entry in
  `apps/web/src/i18n/error-keys.ts` and a string in
  `apps/web/src/i18n/locales/en/errors.json`. Order statuses, conversation
  states and stock statuses need the same, in `status-keys.ts` and
  `common.json`. The maps are `satisfies Record<Enum, ParseKeys<ns>>`, so a
  missing entry fails `pnpm --filter web typecheck`, not runtime.
- Never hardcode a user-facing string in `apps/web` JSX. Copy goes through
  `t()`, and money and dates go through `useFormatters()` in
  `src/lib/format.ts`, which delegates to `formatMinorUnits` from
  `@app/shared`. `packages/shared` must never import i18next. It receives the
  locale as a BCP-47 string.
- Tests live in a colocated `__tests__/` directory, never as a sibling file.
  This applies to both apps.
- A route's error codes and statuses are its `@ApiCodedError(...)`
  decorators. Feature docs' error tables must match them.
- `docs/superpowers/` is gitignored (local specs and plans). Never link to it
  from committed docs.
- Project instructions live in `AGENTS.md` only. Do not create `CLAUDE.md` or
  `CLAUDE.local.md`. Either one stops Claude Code from loading this file.
