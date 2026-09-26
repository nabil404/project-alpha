---
name: backend-engineer
description: Backend engineering conventions for apps/api, the NestJS API and worker behind the Messenger-to-Order MVP (Drizzle, drizzle-kit migrations, BullMQ + Redis, Better Auth, Meta Messenger webhooks, LLM order extraction). Use this skill for ANY backend work — writing a repository or query, changing the schema, adding a module, wiring a queue job, handling a webhook, calling the LLM, or adding config. Trigger it even when the user doesn't name the stack explicitly. Calling the LLM inside a database transaction, or a repository method that forgets merchantId, is a stuck connection pool or a cross-seller data leak rather than a style nit, so consult this before writing code rather than after.
---

# Backend Engineer

Backend conventions for **`apps/api`** — the NestJS API and background worker
behind the Messenger-to-Order MVP. Stack is **NestJS 12 · TypeScript · Postgres

- Drizzle · drizzle-kit migrations · BullMQ + Redis · Better Auth · Zod**.

`AGENTS.md` at the repo root is the project's source of truth. This skill is the
backend operating manual; where the two disagree, `AGENTS.md` wins.

Two areas are load-bearing — a mistake is a **leak or an outage**, not a bug —
and are marked ⚠️ below.

## Platform facts

- **The API and the worker are one codebase.** The worker boots the same
  `AppModule` through `NestFactory.createApplicationContext` (`src/worker.ts`),
  with no HTTP server, so config, repositories and the queue behave identically
  in both processes. Anything you register in a module is live in both.
- **NestJS 12 is ESM-only.** The package is `"type": "module"` on NodeNext, so
  **every relative import ends in `.js`** — `./foo.js`, not `./foo` — including
  in tests and including when the file on disk is `.ts`. This is the single
  easiest thing to get wrong.
- **Drizzle infers types from the schema**, so there is no codegen step and no
  live database needed to typecheck. A schema edit without its migration is what
  CI catches, not stale types.
- Routes are served at `/api/v1/...`: global prefix `api` plus Nest URI
  versioning with `defaultVersion: '1'` (`src/bootstrap.ts`). `/health` is
  excluded from the prefix and marked `VERSION_NEUTRAL`. Versioning policy:
  `rest-api-design`.
- **Every route needs a session by default.** `SessionGuard`
  (`src/auth/session.guard.ts`) is a global `APP_GUARD`; a route that must stay
  public is marked `@AllowAnonymous()` from `@thallesp/nestjs-better-auth`, as
  health and the Messenger webhook are. Better Auth itself is mounted at
  `/api/v1/auth/*` by `src/auth/auth.module.ts`, which also turns Nest's body
  parser off: JSON parsing and `req.rawBody` now come from that module's
  `bodyParser` option, so `rawBody: true` on `NestFactory` does nothing.
- **There are no business endpoints yet.** The only controllers in the repo are
  health and the Messenger webhook, so there is no existing request → guard →
  repository path to copy. The conventions below are the pattern to establish.
- **`no-console` is an eslint rule** with `warn`/`error` allowed. It exists
  because tokens must never reach the logs — see Config and secrets.

### This codebase is still greenfield — expect empty files

`src/database/schema/` contains only `auth.ts` — Better Auth's seven tables,
generated, not hand-written. **No business table exists yet**, so every table you
reference has to come with the schema file and migration that create it. The two
migrations are `0000_auth_tables` and `0001_rls_runtime_role`; the latter creates
no table. Don't
hand-write types to work around this.

## The non-negotiable invariants

Before writing or reviewing backend code, confirm all of these hold. If a change
violates one, stop and fix the design rather than working around it.

1. ⚠️ **Never call the LLM — or any slow external API — inside a database
   transaction.** Read state, make the call outside, _then_ open a short
   transaction that locks the row, re-checks state, and writes.
2. ⚠️ **Every repository method that touches business data takes `merchantId`
   and filters by it.** Each seller only ever sees their own Pages, catalog,
   conversations and orders.
3. **Inside a transaction, always use the transaction object.** Repository
   methods take an executor parameter; they never reach for `this.db`.
4. **Order creation is idempotent** — the same confirmation never creates two
   orders.
5. **Every Meta webhook request is signature-verified and deduplicated.**
6. **Page access tokens and secrets are encrypted at rest and never logged.**
7. **No order is ever created without explicit customer confirmation.** The
   backend must not expose a path that bypasses it.

## ⚠️ Tenancy

- **The merchant comes from the session, never from the request payload.**
  `TenantGuard` (`src/common/tenant.guard.ts`) reads
  `session.activeOrganizationId` — the Better Auth Organization plugin's active
  org — and puts it on `request.merchantId`. **Never** derive the merchant from
  a body field, query parameter or header: accepting a client-supplied value
  makes the whole boundary bypassable.

- **The organization is created at signup**, by `ensureOrganizationForUser`
  (`src/database/ensure-organization.ts`), called from the `user.create.after`
  and `session.create.before` hooks in `src/auth/auth.config.ts`. It is
  idempotent on purpose: `user.create.after` runs after the user row is
  committed, so a failure there would otherwise strand a seller with no merchant
  and the guard would answer every one of their requests with
  `TENANT_NO_ACTIVE_MERCHANT`. The session hook calls the same function, so such
  an account repairs itself at next login. It locks the seller's `user` row with
  `.for('update')` before re-checking membership — at READ COMMITTED two racing
  sign-ins cannot see each other's uncommitted `member` row, and a unique
  constraint on `member.userId` is not available as a fix because it would
  forbid the second organization. The MVP ships one organization per seller and
  no switcher, but the model permits several.

> **Current state.** Better Auth is mounted at `/api/v1/auth/*` and the global
> `SessionGuard` puts Better Auth's `{ session, user }` on `request.session`,
> so the organization bootstrap now runs on every real signup and login
> (exercised by `src/auth/__tests__/email-password.e2e.spec.ts`). `TenantGuard`
> is **per-route**, not global: put `@UseGuards(TenantGuard)` on each business
> controller, where it reads `request.session.session.activeOrganizationId`.

- **The guard is a convenience, not the boundary.** Repositories still take
  `merchantId` explicitly and filter on it. The contract already exists in
  `src/database/base.repository.ts`:

```ts
export type Executor = Database | Transaction;
export interface TenantScope {
  merchantId: string;
}
```

Every business-data method takes both — an executor so it works inside and
outside a transaction, and a scope so it cannot forget the filter. **A service
that injects `DATABASE` and queries a business table without a `merchant_id`
predicate is the leak to catch in review.**

- **Data modeling follows from this.** Every business table carries
  `merchant_id`; composite indexes lead with it (`(merchant_id, created_at)`,
  `(merchant_id, status)`); and **every uniqueness rule includes it** —
  `UNIQUE (merchant_id, sku)`, never a bare global `UNIQUE (sku)`, which is both
  a cross-seller collision and an information leak. Because a seller may hold
  several organizations, this holds even within one seller: their two shops may
  legitimately reuse a SKU, and the same person messaging both is correctly two
  customer rows, so `UNIQUE (merchant_id, psid)` and not `UNIQUE (psid)`.

  **The one deliberate exception is the connected Facebook Page**, which is
  globally unique — `UNIQUE (page_id)`, with no `merchant_id`. The webhook
  resolves `pageId → merchant` with no session to go on
  (`src/modules/messenger/webhook-payload.ts`), so a Page claimed by two tenants
  has no resolvable owner. Scoping that constraint by merchant would let the
  second seller connect a Page the first already owns and silently split their
  conversations. It is the exception, not a missed `merchant_id`.

- **Required test, per AGENTS.md:** two merchants, proving one can never read,
  update, or confirm the other's data. Write it for every repository, not once.

### Row-level security (groundwork in place — policies still to come)

RLS is the defense-in-depth layer on top of the `merchant_id` filter. The
machinery it needs now exists; **no policy does**, because no business table
does. A policy is declared in the schema beside its table (see §"Authoring the
policies" below) and so ships with the migration that creates it, never
retrofitted. What that generates, per business table:

```sql
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_merchant_isolation" ON "order" AS PERMISSIVE FOR ALL TO public
  USING      ("order"."merchant_id" = app_current_merchant())
  WITH CHECK ("order"."merchant_id" = app_current_merchant());
-- FORCE is NOT generated - add it in a db:custom migration:
ALTER TABLE "order" FORCE ROW LEVEL SECURITY;
```

> ⚠️ **RLS still protects nothing today** — there is no table to protect. The
> application-level `merchant_id` predicate remains the tenant boundary, and RLS
> is the backstop for a query that forgets it, never a licence to omit it.

**What is now in place** (`db/migrations/*_rls_runtime_role.sql`):

- **`app_runtime`, a non-superuser role**, `NOBYPASSRLS`, with `GRANT`s on all
  tables and sequences plus `ALTER DEFAULT PRIVILEGES` so future tables are
  covered without a follow-up grant. This is the prerequisite everything else
  rests on: **a superuser ignores every policy unconditionally**, and `FORCE`
  does not change that (`FORCE` closes the table _owner_ bypass, a different
  thing). Connecting as the bootstrap superuser makes every policy silently
  inert — verified: with `ENABLE` + `FORCE` and no context set, the restricted
  role sees 0 rows and the superuser sees all of them.
  The role is created `NOLOGIN` and carries no password. `docker/postgres-init/`
  gives it one on a fresh volume; on an existing cluster an operator runs
  `ALTER ROLE app_runtime LOGIN PASSWORD '...'` once. Better Auth's tables need
  these grants too — but **must never get a policy**: they carry no
  `merchant_id`, and the session lookup runs before any merchant context exists.
- **Two connection strings.** `DATABASE_URL` is the application's restricted
  connection. `DATABASE_ADMIN_URL` is the owner, used only by schema tooling:
  `db:generate`, `db:migrate`, `db:auth-schema` (via `src/auth/auth.cli.ts`), and the
  CI deploy step. **Never give the admin URL to the api or worker** — it is
  deliberately absent from `env.schema.ts` so it cannot be read through
  `AppConfig`.
- **`app_current_merchant()`**, the function policies read. **It returns `text`,
  not `uuid`** — `merchant_id` references `organization(id)`, and the Better Auth
  Organization plugin generates that id as a random string, so a uuid-returning
  helper would not type-check against the column it guards. It wraps the setting
  in `NULLIF(..., '')`, which is load-bearing rather than defensive: a
  transaction-local `set_config` does not unset the GUC at commit, it reverts to
  the empty string, so on a pooled connection every query after the first
  `withMerchant()` sees `''`. Unguarded that is a real value a policy would
  compare against; wrapped, it is NULL, the predicate is NULL, and the policy
  exposes no rows. Pinned by `src/database/__tests__/with-merchant.spec.ts`.
- **`withMerchant(db, merchantId, fn)`** in `src/database/with-merchant.ts` — the
  context gate. It opens a transaction, runs
  `set_config('app.current_merchant', $1, true)`, and hands the callback the
  transaction.

```ts
await withMerchant(db, merchantId, (tx) => ordersRepo.listForMerchant(tx, { merchantId }));
```

> **Two consequences to hold onto.** The setting is transaction-local by
> necessity — pooled connections are reused, so a session-level value would bleed
> one merchant's context into another's request — which means **every business
> query, reads included, runs in a transaction**. Budget against
> `DATABASE_POOL_MAX` and `idle_in_transaction_session_timeout`. And because it
> opens a transaction, **never wrap an LLM or Graph API call in it** (invariant
> #1): read state, call outside, then open it to write.

**Still open, to decide with the first tables:**

- **The webhook bootstrap path.** A job carries a Page id and must resolve it to
  a merchant — a read that happens _before_ any merchant context exists, so a
  policy on `page` would block the very query that establishes the context.
  Prefer a narrow `SECURITY DEFINER` resolver owned by the schema owner, with
  `EXECUTE` granted to `app_runtime`, returning only the merchant id. Do **not**
  write a policy that permits reads when no context is set: that reopens the hole
  for every table it touches.
- **Policies themselves**, one per business table, declared in its schema file, plus the `FORCE` that `db:custom` must carry alongside.

### Authoring the policies

**Policies live in the schema, beside the table they protect.** `pgPolicy` in a
`pgTable` definition makes drizzle-kit emit `ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY`, so a table and its isolation rule are never separated:

```ts
export const order = pgTable(
  'order',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => organization.id),
  },
  (table) => [
    pgPolicy('order_merchant_isolation', {
      for: 'all',
      using: sql`${table.merchantId} = app_current_merchant()`,
      withCheck: sql`${table.merchantId} = app_current_merchant()`,
    }),
  ],
);
```

**What drizzle-kit does not model**, and so must be hand-authored with
`pnpm --filter api db:custom`: `FORCE ROW LEVEL SECURITY`, roles, `GRANT`s,
`ALTER DEFAULT PRIVILEGES`, functions and triggers. `FORCE` is the one to
remember — drizzle-kit emits `ENABLE` and the policy but not `FORCE`, so a table
can look protected and still be bypassable by its owner.

That gap is exactly what **`pnpm --filter api db:verify-rls`** exists to catch: it
fails if any table carrying `merchant_id` is missing `ENABLE`, `FORCE`, or a
policy. Run it after `db:migrate`; CI runs it too. It is a backstop for a
forgotten migration; it does not check that a policy is _correct_. That is what
the two-merchant repository tests are for.

## Database: Drizzle

- **drizzle-kit is the only tool that changes the schema.** Never hand-edit a
  _generated_ migration, never apply DDL directly, and **never run
  `drizzle-kit push`** — it syncs without a reviewable migration. The loop is:
  edit `src/database/schema/` → `pnpm --filter api db:generate` → **review the
  generated SQL by hand** → `pnpm --filter api db:migrate` →
  `pnpm --filter api db:verify-rls`.
  The one sanctioned exception is DDL drizzle-kit does not model, authored with
  `pnpm --filter api db:custom`. drizzle-kit still owns ordering and apply.
- **Migrations are applied by `scripts/migrate.mjs`**, drizzle-orm's programmatic
  migrator, so the same command works locally and in the production image — which
  carries `db/migrations` but not drizzle-kit. `db:generate` still needs
  drizzle-kit, but only ever on a developer's machine or in CI.
- **drizzle-kit diffs against JSON snapshots in `db/migrations/meta`**, not a
  shadow database, so no Docker is needed to generate a migration. Commit the
  snapshot with the migration; CI fails if a schema change has none.
- **Better Auth owns `user`, `session`, `account`, `verification` and the
  organization tables.** Regenerate with `pnpm --filter api db:auth-schema`,
  which overwrites `src/database/schema/auth.ts` — never hand-edit it. Its tables
  then flow through `db:generate` like any other, so auth changes are versioned
  and reviewed rather than applied out of band.
- **Money is integer minor units** (paisa/cents), never a float or `numeric`.
  Use the `@app/shared` helpers rather than dividing inline.
- **`jsonb` columns are parsed with Zod on read.** An inferred `unknown` is not
  validation.
- **Counts and `bigint` values come back as strings** from Postgres — convert
  them explicitly rather than letting a string reach arithmetic.
- Pool-level `lock_timeout` and `idle_in_transaction_session_timeout` are
  already set in `src/database/database.module.ts`; don't re-set them per query.

## Queue and worker

- **Webhook processing is queue-based**: acknowledge Meta immediately, do the
  work in the worker. **The Meta message ID is the BullMQ `jobId`**
  (`src/modules/queue/queue.constants.ts`), which is what makes a redelivered
  webhook a no-op — this is invariant #5's dedupe half, and it only works if you
  keep passing `{ jobId: job.messageId }`.
- **Per-customer message ordering** comes from a Drizzle `.for('update')` row
  lock on the conversation inside a short transaction. Note it is available on
  the query builder but **not** on the relational `db.query.*` API. Combined with invariant #1:
  lock, re-check state, write, commit — with the LLM call already done outside.
- **`WORKER_CONCURRENCY` must stay at or below `DATABASE_POOL_MAX`** (5 and 10
  today). Concurrency above the pool size just queues workers on connections and
  makes lock timeouts fire.
- Retry and backoff defaults are set once in
  `src/modules/queue/queue.module.ts` — configure there, not per `add()` call.
- **A job carries a Page id, not a merchant.** Resolve the merchant from the
  Page first, then pass `merchantId` explicitly into every repository call, the
  same as an HTTP request would.

## Messenger webhooks

- **The HMAC is computed over the unparsed body.** `rawBody: true` in
  `src/main.ts` and `verifyMetaSignature`
  (`src/modules/messenger/signature.ts`) are load-bearing: any middleware that
  reparses or re-stringifies the body breaks verification. The comparison uses
  `timingSafeEqual` against a length check — keep it that way.
- `parseInboundJobs` deliberately **skips echoes**. An echo is the seller's own
  reply, which _pauses the bot_ rather than being customer input.
- The Graph API version is pinned through `META_GRAPH_VERSION`.
- Respect the **Messenger 24-hour messaging window**.

## ⚠️ LLM boundaries

The strictest rules in the project. The LLM is a parser, not the driver.

- **A deterministic state machine drives the conversation** —
  `browsing → collecting_details → awaiting_confirmation → confirmed`, plus
  `handed_off` and `abandoned`. The LLM classifies intent and extracts fields;
  **code decides what happens next.**
- **Code validates every extracted item against the seller's catalog.** The AI
  only ever quotes prices, variants, stock and delivery charges _from the
  catalog_. It never invents a discount or availability.
- **Structured JSON output with Zod schemas from `@app/shared`**, behind an
  `extractOrder()` wrapper. Provider and model come from env — `LLM_PROVIDER`,
  `LLM_MODEL_ROUTING`, `LLM_MODEL_EXTRACTION` — with the smaller model for
  intent and routing and the larger one only for extraction.
- **Hand off instead of guessing**: low confidence, repeated confusion, a
  complaint, or an explicit request for a human. **If the LLM fails or times
  out, hand off gracefully — the customer is never left without a reply.**
- **The call happens outside the transaction** (invariant #1). Read state, call,
  then lock and write.
- Track LLM cost per conversation, and re-run the evaluation set of real
  conversations after **every** prompt change.

## Config, secrets and logging

- **`env.schema.ts` is Zod-validated once at startup** — a missing secret stops
  the process, not a request. Read config through the typed `AppConfig`
  accessor; **no module reads `process.env` directly.**
- **Page access tokens are encrypted with `CryptoService`** (AES-256-GCM, layout
  `base64(iv | authTag | ciphertext)`). Store the ciphertext; decrypt at the
  point of use.
- **The pino `redact` list in `src/app.module.ts`** covers the `authorization`
  and `cookie` headers, `x-hub-signature-256`, and any `*.accessToken` /
  `*.pageAccessToken` field. **Extend it whenever you add a new secret-bearing
  field** — redaction is opt-in, so a new field name is unredacted by default.

## Validation

`ZodValidationPipe` (`src/common/zod-validation.pipe.ts`) validates request
bodies against the **same schemas from `@app/shared`** that back the SPA's forms
and the LLM's output. Don't hand-write a parallel DTO class — derive from the
shared schema instead. Run `pnpm --filter @app/shared build` after changing one,
or the API typechecks against the stale build.

## Testing

- Jest runs as **ESM** (`NODE_OPTIONS=--experimental-vm-modules`, ts-jest ESM
  preset). Keep `.js` extensions on relative imports inside specs.
- **Specs live in a colocated `__tests__/` directory**, never as a sibling file.
- **Focus, per AGENTS.md: the state machine, tenant isolation, and extraction
  accuracy** — not coverage for its own sake.
- **Prefer pure functions tested without the Nest container.**
  `src/modules/messenger/__tests__/signature.spec.ts` and
  `webhook-payload.spec.ts` are the model: real inputs, no mocks, no DI.
- **Two-merchant isolation tests are required** for every repository that
  touches business data.
- Assert on the real failure, not just that something threw — the signature spec
  checks a wrong secret and a tampered body separately, and that is the standard.

## Related skills

- **`frontend-engineer`** — `apps/web`, which consumes these endpoints through a
  same-origin `/api/v1` client and the shared Zod schemas.
- **`rest-api-design`** — resource naming, status codes, pagination and
  versioning for the HTTP surface built on these conventions.

## Pre-merge review checklist

- [ ] No LLM or other slow external call inside a transaction; the transaction
      is opened after the call, locks the row, and re-checks state.
- [ ] Every repository method touching business data takes `merchantId` and
      filters by it; the merchant came from the session, never the payload.
- [ ] Repository methods take an `Executor`; nothing reaches for `this.db`
      inside a transaction.
- [ ] New business tables carry `merchant_id`; composite indexes lead with it;
      every unique constraint includes it.
- [ ] Schema changed only through the drizzle-kit loop; migration reviewed by hand;
      `database.types.ts` regenerated, not edited; Better Auth tables generated.
- [ ] Money is integer minor units; `jsonb` parsed with Zod on read; counts and
      `bigint` converted from strings explicitly.
- [ ] Queue jobs keep the Meta message ID as `jobId`; order creation is
      idempotent; `WORKER_CONCURRENCY` ≤ `DATABASE_POOL_MAX`.
- [ ] Webhook signature verified over the raw body with `timingSafeEqual`.
- [ ] Handoff path exists for low confidence, complaints, human requests, and
      LLM failure or timeout.
- [ ] No token or secret is logged; new secret-bearing fields added to the pino
      `redact` list.
- [ ] Request bodies validated with `ZodValidationPipe` against `@app/shared`;
      no parallel hand-written DTO.
- [ ] New/changed code has specs under a `__tests__/` directory, including a
      two-merchant isolation test where business data is involved.
- [ ] Every relative import ends in `.js`.
