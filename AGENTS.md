# Messenger-to-Order MVP — Project Context

Source of truth: this file. It was generated from the Asana page
"📘 START HERE: MVP Project Context" (sections 1–11). If the two disagree, this
file is the current version; update it here first.

Timeline: 12 weeks, solo developer, Sep 21 – Dec 11, 2026.

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
  Better Auth, which uses Kysely natively. Their SQL is generated with the
  Better Auth CLI and kept in the auth section of `apps/api/db/schema.sql`.
- **Organization** (seller account / tenant) — via the Better Auth Organization
  plugin. One organization per seller for the MVP. Every business table carries
  `merchant_id` and all queries are scoped by it.
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
stays in our own database. Webhook processing is queue-based — acknowledge
immediately, process in background workers, use the Meta message ID as the job
ID for deduplication, and hold a row lock on the conversation to keep each
customer's messages in order. The LLM only parses, with structured JSON output
(smaller model for intent/routing, larger only for extraction, provider and
model set through env vars); a deterministic state machine drives the
conversation and code validates every extracted item against the catalog. LLM
cost is tracked per conversation. Tests are written alongside features, and the
evaluation set of real conversations is run after every prompt change.

### Chosen stack

| Area                | Decision                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend             | NestJS. API and worker share one codebase; the worker boots via `createApplicationContext`.                                                                                                                                                                                         |
| Frontend            | React (Vite SPA), React Router or TanStack Router, TanStack Query, Tailwind, shadcn/ui, react-hook-form.                                                                                                                                                                            |
| Repo                | pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`. Everything database-related lives in `apps/api`.                                                                                                                                                                        |
| Validation          | Zod schemas in `packages/shared` for API input, forms, and LLM output.                                                                                                                                                                                                              |
| Database            | Postgres + Kysely, exact version pinned (pre-1.0; read release notes before upgrading). Global NestJS `DatabaseModule`; Better Auth shares the same pool.                                                                                                                           |
| Schema & migrations | One sectioned `apps/api/db/schema.sql` as desired state, migrations in `apps/api/db/migrations/`, config in `apps/api/atlas.hcl`. Atlas (`migrate diff` / `lint` / `apply`) is the only tool that changes the schema; generated migrations are always reviewed, especially renames. |
| Types               | kysely-codegen generates `apps/api/src/database/database.types.ts` from the migrated database. CI applies migrations to a fresh Postgres, reruns codegen, and fails on drift.                                                                                                       |
| Message ordering    | Kysely `.forUpdate()` on the conversation row inside a short transaction.                                                                                                                                                                                                           |
| Queue               | BullMQ + Redis (`noeviction`, AOF persistence). Bull Board behind the auth guard.                                                                                                                                                                                                   |
| Auth                | Better Auth: email/password, Google, Facebook; Organization plugin for multi-tenancy; tenant guard in NestJS.                                                                                                                                                                       |
| Messenger           | Graph API via `fetch`, pinned API version, raw-body HMAC signature verification, own Page connection flow.                                                                                                                                                                          |
| Secrets             | Page tokens encrypted with AES-256-GCM (Node `crypto`); key in an env var.                                                                                                                                                                                                          |
| LLM                 | AI SDK behind an `extractOrder()` wrapper, structured output with Zod schemas. Evaluation set of 100–200 real messages, scored per provider.                                                                                                                                        |
| Email               | Nodemailer over SMTP on a transactional provider's free tier; swappable without code changes.                                                                                                                                                                                       |
| Hosting             | Single VPS running Docker Compose: Caddy, api, worker, Postgres, Redis.                                                                                                                                                                                                             |
| Reverse proxy       | Caddy with automatic HTTPS; serves the SPA and proxies `/api` on the same domain. Also serves the static Meta compliance pages.                                                                                                                                                     |
| Config & ops        | `@nestjs/config` with Zod-validated env vars, `@nestjs/throttler` (Redis storage), nestjs-pino logs, `@nestjs/terminus` health checks, Uptime Kuma monitoring, Sentry free tier optional.                                                                                           |
| Backups             | Nightly `pg_dump`, multi-day retention, copied off the server.                                                                                                                                                                                                                      |
| Server security     | SSH keys only, firewall allowing 80/443/SSH, automatic security updates.                                                                                                                                                                                                            |
| CI/CD               | GitHub Actions: test, check codegen drift, build images, run `atlas migrate apply`, deploy over SSH. Database scripts run from `apps/api` (e.g. `pnpm --filter api db:types`). Docker is required in CI for Atlas's dev database.                                                   |
| Local development   | Cloudflare Tunnel for a public HTTPS webhook URL; Docker for Atlas's dev database.                                                                                                                                                                                                  |
| Testing             | Jest plus an LLM evaluation script; focus on the state machine, tenant isolation, and extraction accuracy.                                                                                                                                                                          |
| Payments            | Cash on delivery. Payment links after the pilot.                                                                                                                                                                                                                                    |

### Database rules

> Kept word for word from the project context.

- Never call the LLM (or any slow external API) inside a database transaction. Read state, call the LLM outside, then open a short transaction that locks the row, re-checks state, and writes.
- Inside a transaction, always use the transaction object. Repository methods take an executor parameter (Kysely<DB> | Transaction<DB>) instead of using this.db.
- Every repository method that touches business data takes merchantId and filters by it. Tests with two merchants verify one can never read, update, or confirm the other's data.
- Postgres lock_timeout and idle_in_transaction_session_timeout are set. BullMQ worker concurrency stays at or below the worker's pool size.
- jsonb columns are parsed with Zod on read. Counts and bigint values are converted from strings explicitly.

### Considered and not chosen

CrewAI (Python-only, multi-agent overhead), Clerk (user data stored
externally), Keycloak (separate Java server to operate, higher RAM), Passport
(session assumptions clash with our design, limited strategy maintenance),
Arctic (deprecated by its author), pg-boss (BullMQ preferred), Prisma (replaced
by Kysely for SQL control, built-in row locking, and native Better Auth
support), TypeORM (Better Auth support only through a small community adapter),
per-module schema files (extra build step and ordering file; one sectioned
`schema.sql` is enough), Next.js (unneeded server layer once NestJS owns the
backend), Anthropic SDK alone (replaced by AI SDK for provider independence).

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
- Schema loop: edit `apps/api/db/schema.sql` → `pnpm db:diff` → review the
  migration → `pnpm --filter api db:lint` → `pnpm db:apply` → `pnpm db:types`.
- `pnpm --filter api db:hash` — rehash after a reviewed migration edit.
- `pnpm --filter api db:auth-schema` — regenerate Better Auth SQL, then paste
  it into the auth section of `schema.sql`.
- `apps/web` has no tests yet; `apps/api` Jest runs as ESM
  (`--experimental-vm-modules`).

## Conventions for Claude Code

- Commit messages: no co-author trailers.
- Atlas is the only tool that changes the database schema; never hand-edit a
  _generated_ migration and never apply DDL directly. For DDL Atlas does not
  diff on the free tier (RLS policies, roles, grants), author it with
  `atlas migrate new` and rerun `db:hash` — Atlas still owns ordering,
  integrity, and apply.
- Never log tokens, secrets, or raw Page access tokens.
- Errors leave the API as the coded envelope `{ error: { code, message, params } }`.
  Throw a `Coded*Exception` from `apps/api/src/common/errors/`, never a bare NestJS
  exception; the contract is in
  `.claude/skills/rest-api-design/references/response-formats.md`.
- Tests live in a colocated `__tests__/` directory, never as a sibling file.
  This applies to both apps.
- Project instructions live in `AGENTS.md` only. Do not create `CLAUDE.md` or
  `CLAUDE.local.md`; either one stops Claude Code from loading this file.
