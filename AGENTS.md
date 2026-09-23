# Messenger-to-Order MVP — Project Context

Source of truth: this file. It was generated from the Asana page
"📘 START HERE: MVP Project Context" (sections 1–11). If the two disagree, this
file is the current version; update it here first.

Timeline: 12 weeks, solo developer, Sep 21 – Dec 11, 2026.

Per-app conventions live in `.claude/skills/`: **`backend-engineer`** (`apps/api`
— Drizzle, queue, webhooks, LLM), **`frontend-engineer`** (`apps/web` —
data layer, forms, i18n, Tailwind), **`rest-api-design`** (HTTP surface). Those
are the authority on _how_; this file is the authority on _what_ and _why_, and
wins on any conflict.

## 1. Problem and goal

Sellers on Facebook Pages lose hours in Messenger answering the same questions,
collecting addresses, and copying orders into notebooks or spreadsheets. Orders
get lost and replies are slow.

**Goal:** turn Facebook/Messenger customer conversations into confirmed orders
with as little manual work as possible. Channel: Facebook Pages and Messenger
only.

## 2. Core flow

Customer messages the Page → AI understands intent → AI identifies the product
from the seller's catalog → AI asks only for missing details → customer
explicitly confirms the order summary → order is created automatically → seller
sees it in the dashboard → seller fulfills it.

## 3. Users

- **Seller** — owns a Facebook Page, signs up, connects the Page, manages
  catalog and orders.
- **Customer** — messages the Page in Messenger. Never uses our dashboard.

## 4. In scope

- Seller authentication (Better Auth): email/password with email verification
  and password reset, Google sign-in, Facebook sign-in. Google accounts link to
  existing accounts by verified email; Facebook accounts link only explicitly
  from account settings, since Facebook does not guarantee a verified email.
- Connect Facebook Page: a separate step after sign-in that requests Page
  permissions. Facebook sign-in itself requests only `public_profile` and
  `email`.
- Product catalog: products, aliases, variants, prices, images, stock status,
  delivery charges, CSV import.
- AI: intent classification, product matching, slot-filling, confirmation,
  mid-flow edits.
- Automatic order creation with the order ID sent to the customer.
- Human handoff, and bot auto-pause when the seller replies manually.
- Seller dashboard: orders list and detail with transcript, status changes,
  edits, notes, Needs Attention queue, conversation viewer, bot on/off toggle,
  CSV export.
- Email notifications for new orders and handoffs.
- Responsive web dashboard.

## 5. Out of scope (Post-MVP Backlog)

Instagram, WhatsApp, website chat; online payments (assume cash on delivery or
manual confirmation); courier integrations and external inventory sync;
multi-user team roles and mobile apps; image/screenshot product matching, stats
page, post-order status messages, comment-to-Messenger replies, abandoned-chat
follow-ups, repeat-customer recognition.

"Multi-user team roles" above means several users inside one organization. It is
not the same thing as several organizations per seller, which the data model
already allows (§9); only the switcher for it is deferred.

## 6. Non-negotiable rules

> Kept word for word from the project context.

- No order is ever created without explicit customer confirmation (Confirm button on the summary card).
- The AI only quotes prices, variants, stock, and delivery charges from the seller's catalog. It never invents discounts or availability.
- When unsure (low confidence, repeated confusion, complaints, human request), hand off to the seller instead of guessing.
- If the LLM fails or times out, hand off gracefully. The customer is never left without a reply.
- Order creation is idempotent: the same confirmation never creates two orders.
- Each seller can only ever see their own Pages, catalog, conversations, and orders.
- Page access tokens and secrets are encrypted at rest and never logged.
- Every Meta webhook request is signature-verified and deduplicated.

Backend enforcement of these: `.claude/skills/backend-engineer/SKILL.md`
§"The non-negotiable invariants".

## 7. Conversation states

`browsing → collecting_details → awaiting_confirmation → confirmed`, plus
`handed_off` and `abandoned`.

Required order fields: product, variant, quantity, customer name, phone,
delivery address.

## 8. Order statuses

`New → Confirmed → Packed → Shipped → Delivered`, or `Cancelled`.

## 9. Data model

- **Seller / User** — account and auth identities (password, Google, Facebook).
  The `user`, `session`, `account`, and `verification` tables are owned by
  Better Auth. Their Drizzle schema is generated with the Better Auth CLI into
  `apps/api/src/database/schema/auth.ts` and migrated through drizzle-kit like
  any other table, so auth changes stay versioned and reviewed.
- **Organization** (seller account / tenant) — via the Better Auth Organization
  plugin, created automatically at signup with the seller as its owner. The
  model permits several organizations per seller, because membership is a table
  rather than a column; the MVP ships one and offers no switcher, so adding one
  later needs no migration. Every business table carries `merchant_id`, which
  references `organization(id)` and never `user(id)`, and all queries are scoped
  by it.
- **Page** — connected Facebook Page, encrypted token, bot on/off.
- **Product / Variant** — name, aliases, price, images, stock status, delivery
  charge.
- **Customer** — Messenger PSID, name, phone, address.
- **Conversation** — customer, Page, state, collected slots, bot paused flag.
- **Message** — direction, content, timestamps, Meta message ID.
- **Order / OrderItem** — items, totals, delivery charge, status, notes, linked
  conversation.

Money is stored as integer minor units (e.g. paisa/cents), never floats or
`numeric`.

## 10. Tech approach

Principles: self-host where practical on free, open-source libraries; recurring
costs limited to the VPS, the domain, and pay-per-use LLM calls; all user data
stays in our own database. Webhook processing is queue-based and the LLM only
parses — a deterministic state machine drives the conversation and code validates
every extracted item against the catalog. LLM cost is tracked per conversation.
Tests are written alongside features, and the evaluation set of real
conversations is run after every prompt change. The mechanics of both are in
`backend-engineer` (§"Queue and worker", §"LLM boundaries").

### Chosen stack

| Area                | Decision                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend             | NestJS. API and worker share one codebase; the worker boots via `createApplicationContext`.                                                                                                                        |
| Frontend            | React 19 (Vite SPA), TanStack Router (code-based) + TanStack Query, Tailwind v4 (CSS-first), shadcn/ui (not initialized), react-hook-form, react-i18next.                                                          |
| Repo                | pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`. Everything database-related lives in `apps/api`.                                                                                                       |
| Validation          | Zod schemas in `packages/shared` for API input, forms, and LLM output.                                                                                                                                             |
| Database            | Postgres + Drizzle. Global NestJS `DatabaseModule`; Better Auth shares the same instance through its Drizzle adapter.                                                                                              |
| Schema & migrations | TS schema in `apps/api/src/database/schema/` as desired state; drizzle-kit generates SQL into `db/migrations/`. `drizzle-kit push` is never used.                                                                  |
| Types               | Inferred from the schema — no codegen step and no live database needed. CI fails if a schema change has no migration.                                                                                              |
| Message ordering    | Drizzle `.for('update')` on the conversation row inside a short transaction. Not available on the relational (`db.query.*`) API.                                                                                   |
| Queue               | BullMQ + Redis (`noeviction`, AOF persistence).                                                                                                                                                                    |
| Auth                | Better Auth: email/password, Google, Facebook; Organization plugin for multi-tenancy, the seller's organization created at signup and resolved onto the session as `activeOrganizationId`; tenant guard in NestJS. |
| Messenger           | Graph API via `fetch`, pinned API version, raw-body HMAC signature verification, own Page connection flow.                                                                                                         |
| Secrets             | Page tokens encrypted with AES-256-GCM (Node `crypto`); key in an env var.                                                                                                                                         |
| LLM                 | AI SDK behind an `extractOrder()` wrapper, structured output with Zod schemas. Evaluation set of 100–200 real messages, scored per provider.                                                                       |
| Email               | Nodemailer over SMTP on a transactional provider's free tier; swappable without code changes.                                                                                                                      |
| Hosting             | Single VPS running Docker Compose: Caddy, api, worker, Postgres, Redis.                                                                                                                                            |
| Reverse proxy       | Caddy with automatic HTTPS; serves the SPA and proxies `/api` on the same domain. Also serves the static Meta compliance pages.                                                                                    |
| Config & ops        | `@nestjs/config` + Zod-validated env, `@nestjs/throttler` (Redis), nestjs-pino, `@nestjs/terminus` health checks, Uptime Kuma, Sentry optional.                                                                    |
| Backups             | Nightly `pg_dump`, multi-day retention, copied off the server.                                                                                                                                                     |
| Server security     | SSH keys only, firewall allowing 80/443/SSH, automatic security updates.                                                                                                                                           |
| CI/CD               | GitHub Actions: lint, typecheck, test, migrate, RLS check, uncommitted-migration check, build images, deploy over SSH.                                                                                             |
| Local development   | Cloudflare Tunnel for a public HTTPS webhook URL. drizzle-kit diffs against snapshots, so no shadow database is needed.                                                                                            |
| Testing             | Jest in `apps/api`, Vitest in `apps/web` when its first test lands, plus an LLM evaluation script.                                                                                                                 |
| Payments            | Cash on delivery. Payment links after the pilot.                                                                                                                                                                   |

### Database rules

> Kept word for word from the project context.

- Never call the LLM (or any slow external API) inside a database transaction. Read state, call the LLM outside, then open a short transaction that locks the row, re-checks state, and writes.
- Inside a transaction, always use the transaction object. Repository methods take an executor parameter (`Executor`, i.e. `Database | Transaction`) instead of using this.db.
- Every repository method that touches business data takes merchantId and filters by it. Tests with two merchants verify one can never read, update, or confirm the other's data.
- Postgres lock_timeout and idle_in_transaction_session_timeout are set. BullMQ worker concurrency stays at or below the worker's pool size.
- jsonb columns are parsed with Zod on read. Counts and bigint values are converted from strings explicitly.

Worked examples, the executor pattern, and the two-merchant test shape:
`backend-engineer` §"⚠️ Tenancy" and §"Database: Drizzle".

### Considered and not chosen

Eleven alternatives were evaluated and rejected — CrewAI, Clerk, Keycloak,
Passport, Arctic, pg-boss, Prisma, TypeORM, per-module schema files, Next.js,
and the Anthropic SDK alone. Reasons are in
[docs/decisions.md](docs/decisions.md); read it before proposing any of them
again.

## 11. Meta requirements

- Business Verification — start Week 1.
- App Review for advanced access to `pages_messaging` and related Page
  permissions — submit by end of Week 4.
- Public privacy policy and data deletion callback (served statically by Caddy,
  alongside terms).
- Respect the Messenger 24-hour messaging window.

## Success metrics (pilot with 3–5 sellers)

≥60% of conversations reach a confirmed order without seller intervention; ≥90%
product identification accuracy; ≥95% of orders with complete, correct fields;
median first message → confirmed order under 10 minutes; zero wrongly created
orders; signup → first connected Page under 10 minutes.

## Commands

- `pnpm dev` — api + web in parallel; worker separately via
  `pnpm --filter api dev:worker`.
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format:check` — from
  the root, recursive.
- Schema loop: edit `apps/api/src/database/schema/` → `pnpm --filter api
db:generate` → **review the generated SQL by hand** → `pnpm --filter api
db:migrate` → `pnpm --filter api db:verify-rls`.
- `pnpm --filter api db:custom` — an empty migration for DDL drizzle-kit does
  not model: `FORCE ROW LEVEL SECURITY`, roles, grants, default privileges,
  functions, triggers.
- `pnpm --filter api db:verify-rls` — fails if a table carrying `merchant_id`
  lacks `ENABLE`/`FORCE` row-level security or a policy. Run after `db:migrate`;
  CI runs it too, because drizzle-kit generates `ENABLE` and the policy but not
  `FORCE`, so nothing else would catch a half-protected table.
- `pnpm --filter api db:auth-schema` — regenerate Better Auth SQL, then paste
  `src/database/schema/auth.ts`, then `db:generate` to migrate it.
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
- `apps/web` and `packages/shared` have no test runner yet; `apps/api` Jest runs
  as ESM (`--experimental-vm-modules`), configured in `apps/api/jest.config.mjs`.
- `pnpm --filter @app/shared build` after changing a shared schema — `apps/api`
  tests and typecheck resolve `@app/shared` through its built `dist`, and CI
  builds it before lint, typecheck and test.

## Conventions for Claude Code

- Commit messages: no co-author trailers.
- drizzle-kit is the only tool that changes the database schema; never
  hand-edit a _generated_ migration, never apply DDL directly, and never run
  `drizzle-kit push`. For DDL drizzle-kit does not model (`FORCE` row-level
  security, roles, grants, default privileges, functions, triggers), author it
  with `pnpm --filter api db:custom` — drizzle-kit still owns ordering and
  apply.
- Never log tokens, secrets, or raw Page access tokens.
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
