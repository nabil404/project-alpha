---
name: backend-engineer
description: Backend engineering conventions for apps/api, the NestJS API and worker behind the Social Glider MVP (Drizzle, drizzle-kit migrations, BullMQ + Redis, Better Auth, Meta Messenger webhooks, LLM order extraction). Use this skill for ANY backend work — writing a repository or query, changing the schema, adding a module, wiring a queue job, handling a webhook, calling the LLM, or adding config. Trigger it even when the user doesn't name the stack explicitly. Calling the LLM inside a database transaction, or a repository method that forgets merchantId, is a stuck connection pool or a cross-seller data leak rather than a style nit, so consult this before writing code rather than after.
---

# Backend Engineer

Backend conventions for **`apps/api`** — the NestJS API and background worker
behind the Social Glider MVP. Stack is \*\*NestJS 12 · TypeScript · Postgres

- Drizzle · drizzle-kit migrations · BullMQ + Redis · Better Auth · Zod\*\*.

`AGENTS.md` at the repo root and the current MVP under `docs/mvp/` are the
project's source of truth. This skill is the backend operating manual; where they
disagree, they win.

Two areas are load-bearing — a mistake is a **leak or an outage**, not a bug —
and are marked ⚠️ below.

## Platform facts

- **The API and the worker are one codebase.** The worker boots `WorkerModule`
  through `NestFactory.createApplicationContext` (`src/worker.ts`), with no HTTP
  server. `WorkerModule` imports the whole `AppModule` plus the queue
  processors' modules, so config, repositories and the queue behave
  identically in both processes; anything registered in a module `AppModule`
  imports is live in both, and only the processors are worker-only.
- **NestJS 12 is ESM-only, but imports are extensionless.** The package is
  `"type": "module"`, and TypeScript resolves with `moduleResolution: Bundler`,
  so write `./foo`, never `./foo.js`. `nest build` compiles with SWC
  (`builder: "swc"`, `typeCheck: true`), and `.swcrc` sets `resolveFully` with a
  `baseUrl` — without the `baseUrl` SWC silently skips the rewrite and `dist`
  fails at runtime with `ERR_MODULE_NOT_FOUND`. Decorator metadata comes from
  `.swcrc` `decoratorMetadata`, which Nest DI depends on.
- **Every Nest module lives under `src/modules/<name>/`** — feature modules
  (products, conversations) and infrastructure ones (auth, config, database,
  health, queue, storage, mail) alike, each with its `<name>.module.ts` and a
  colocated `__tests__/`. A new module goes there, never directly under `src/`.
  Only what isn't a module stays at `src/`: the entry points (`main.ts`,
  `worker.ts`, `bootstrap.ts`, `app.module.ts`, `worker.module.ts`), `common/`
  (guards, pipes, coded errors) and `openapi/`.
- **Drizzle infers types from the schema**, so there is no codegen step and no
  live database needed to typecheck. A schema edit without its migration is what
  CI catches, not stale types.
- Routes are served at `/api/v1/...`: global prefix `api` plus Nest URI
  versioning with `defaultVersion: '1'` (`src/bootstrap.ts`). `/health` is
  excluded from the prefix and marked `VERSION_NEUTRAL`. Versioning policy:
  `rest-api-design`.
- **Every route needs a session by default.** `SessionGuard`
  (`src/modules/auth/session.guard.ts`) is a global `APP_GUARD`; a route that must stay
  public is marked `@AllowAnonymous()` from `@thallesp/nestjs-better-auth`, as
  health and the Messenger webhook are. Better Auth itself is mounted at
  `/api/v1/auth/*` by `src/modules/auth/auth.module.ts`, which also turns Nest's body
  parser off: JSON parsing and `req.rawBody` now come from that module's
  `bodyParser` option, so `rawBody: true` on `NestFactory` does nothing.
- **The first business controller is `ProductImagesController`**
  (`src/modules/products/images/`): `@UseGuards(TenantGuard)`, `uuid` params
  through `ZodValidationPipe`, the merchant from `request.merchantId`, coded
  errors and OpenAPI decorators on every route. Copy its request → guard →
  service → repository path.
- **`no-console` is an eslint rule** with `warn`/`error` allowed. It exists
  because tokens must never reach the logs — see Config and secrets.

### The schema files

`src/modules/database/schema/` holds one file per area, exported in dependency
order from `index.ts`: `auth.ts` (Better Auth's tables, generated, never
hand-written), `pages.ts`, `catalog.ts`, `customers.ts` (with
`customer_note`), `conversations.ts` and `orders.ts` (with `order_item` and
`order_event`). `columns.ts` has the shared builders: `id()`,
`merchantId()`, `createdAt()`/`updatedAt()`, `instant()` for millisecond
timestamps that sort a keyset list, `merchantIsolation()` for the policy and
`oneOf()` for enum checks. A business table you reference that does not exist
yet comes with its schema and migration; don't hand-write types to work
around a missing table.

`src/modules/categories/` and `src/modules/products/` are the pattern to copy:
repositories take `(Executor, TenantScope)`, services open `withMerchant`,
children point at parents through composite `(merchant_id, id)` foreign keys,
soft-delete filters come from each module's `*-visibility.ts`, and module
dependencies run one way (products imports categories, never the reverse).

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
  (`src/modules/database/ensure-organization.ts`), called from the `user.create.after`
  and `session.create.before` hooks in `src/modules/auth/auth.config.ts`. It is
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
> (exercised by `src/modules/auth/__tests__/email-password.e2e.spec.ts`). `TenantGuard`
> is **per-route**, not global: put `@UseGuards(TenantGuard)` on each business
> controller, where it reads `request.session.session.activeOrganizationId`.

- **The guard is a convenience, not the boundary.** Repositories still take
  `merchantId` explicitly and filter on it. The contract already exists in
  `src/modules/database/base.repository.ts`:

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
  globally unique — `UNIQUE (page_id)`, with no `merchant_id`. The worker
  resolves `pageId → merchant` with no session to go on
  (`resolvePageMerchant()` in `src/modules/conversations/ingest/page-merchant.ts`),
  so a Page claimed by two tenants
  has no resolvable owner. Scoping that constraint by merchant would let the
  second seller connect a Page the first already owns and silently split their
  conversations. It is the exception, not a missed `merchant_id`.

- **Required test, per `docs/mvp/01-messenger-to-order/rules.md`:** two merchants, proving one can never read,
  update, or confirm the other's data. Write it for every repository, not once.

### Row-level security

RLS is the defense-in-depth layer on top of the `merchant_id` filter. Every
business table has it enabled **and forced**, with one
`<table>_merchant_isolation` policy declared in its schema file (see
§"Authoring the policies" below), so a table and its policy ship in the same
migration. What that produces, per business table:

```sql
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_merchant_isolation" ON "order" AS PERMISSIVE FOR ALL TO public
  USING      ("order"."merchant_id" = app_current_merchant())
  WITH CHECK ("order"."merchant_id" = app_current_merchant());
-- FORCE is NOT generated - add it in a db:custom migration:
ALTER TABLE "order" FORCE ROW LEVEL SECURITY;
```

> ⚠️ **RLS is the backstop, not the boundary.** The application-level `merchant_id` predicate remains the tenant boundary, and RLS
> is the backstop for a query that forgets it, never a licence to omit it.

**The pieces it rests on:**

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
  `db:generate`, `db:migrate`, `db:auth-schema` (via `src/modules/auth/auth.cli.ts`), and the
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
  exposes no rows. Pinned by `src/modules/database/__tests__/with-merchant.spec.ts`.
- **`withMerchant(db, merchantId, fn)`** in `src/modules/database/with-merchant.ts` — the
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

**The webhook bootstrap path.** `app_page_merchant(text)` resolves a
Page id to its merchant before any context exists. It is `SECURITY DEFINER`,
owned by the `NOLOGIN` role `app_page_resolver`, which holds only
`SELECT (page_id, merchant_id)` on `facebook_page`; the
`facebook_page_resolver_read` policy in `schema/pages.ts` lets it read those
rows. `EXECUTE` is revoked from `PUBLIC` and granted to `app_runtime`, and the
resolver owns the function. What the function can
read therefore does not rely on bypassing row-level security. The migrating
role does still need to be a superuser or hold `SET` membership in
`app_page_resolver`, because `ALTER FUNCTION … OWNER TO` requires it. Call it
through `resolvePageMerchant()`
(`src/modules/conversations/ingest/page-merchant.ts`). Do **not** write a policy
that permits reads when no context is set.

### Authoring the policies

**Policies live in the schema, beside the table they protect.**
`merchantIsolation()` from `schema/columns.ts` wraps `pgPolicy`, so drizzle-kit
emits `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` with the table and the
two are never separated:

```ts
export const order = pgTable(
  'order',
  {
    id: id(),
    merchantId: merchantId(),
    // ...
  },
  (t) => [
    unique('order_merchant_id_uq').on(t.merchantId, t.id),
    merchantIsolation('order_merchant_isolation', t.merchantId),
  ],
);
```

A table outside that one shape (the Page resolver's read on `facebook_page`)
declares its extra `pgPolicy` the same way.

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
  edit `src/modules/database/schema/` → `pnpm --filter api db:generate` → **review the
  generated SQL by hand** → `pnpm --filter api db:migrate` →
  `pnpm --filter api db:verify-rls`.
  The one sanctioned exception is DDL drizzle-kit does not model, authored with
  `pnpm --filter api db:custom`. drizzle-kit still owns ordering and apply.
- **Migrations are applied by `scripts/migrate.mjs`**, drizzle-orm's programmatic
  migrator, so the same command works locally and in the production image,
  which ships `db/migrations` and `scripts/` and runs it as the compose
  `migrate` service. Applying never goes through drizzle-kit; generating a
  migration (`db:generate`) is done only on a developer's machine.
- **drizzle-kit diffs against JSON snapshots in `db/migrations/meta`**, not a
  shadow database, so no Docker is needed to generate a migration. Commit the
  snapshot with the migration; CI fails if a schema change has none.
- **Better Auth owns `user`, `session`, `account`, `verification` and the
  organization tables.** Regenerate with `pnpm --filter api db:auth-schema`,
  which overwrites `src/modules/database/schema/auth.ts` — never hand-edit it. Its tables
  then flow through `db:generate` like any other, so auth changes are versioned
  and reviewed rather than applied out of band.
- **Money is integer minor units** (paisa/cents), never a float or `numeric`.
  Use the `@app/shared` helpers rather than dividing inline.
- **`jsonb` columns are parsed with Zod on read.** An inferred `unknown` is not
  validation.
- **Counts and `bigint` values come back as strings** from Postgres — convert
  them explicitly rather than letting a string reach arithmetic.
- Pool-level `lock_timeout` and `idle_in_transaction_session_timeout` are
  already set in `src/modules/database/database.module.ts`; don't re-set them per query.

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
- **`WORKER_CONCURRENCY` must stay at or below `DATABASE_POOL_MAX`** (defaults
  5 and 10). Concurrency above the pool size just queues workers on connections
  and makes lock timeouts fire. The variable is validated but not yet passed to
  any processor: they run at BullMQ's default concurrency of 1. Wire it through
  `@Processor`'s options when a queue needs more.
- Retry and backoff defaults are set once in
  `src/modules/queue/queue.module.ts` — configure there, not per `add()` call.
- **A job carries a Page id, not a merchant.** Resolve the merchant from the
  Page first, then pass `merchantId` explicitly into every repository call, the
  same as an HTTP request would.

## Object storage

- **Everything goes through `ObjectStorage`** (`src/modules/storage/`); nothing
  else imports `@aws-sdk/*`. Tests use `InMemoryObjectStorage` from
  `src/modules/storage/__tests__/`.
- **Keys are built only by their helpers** — `productImageKeys()` from the
  session's merchant id and a server-made uuid, `avatarKey()` from the signed-in
  user's id and a server-made uuid — never from a request. Objects are
  immutable; a new photo is a new key.
- **Storage calls follow invariant #1**: never inside a transaction. Store the
  object first, then open the short transaction that writes the row; on
  failure, delete the object best-effort and let the daily sweep catch misses.
  Deleting a row works the other way round: commit first, then delete objects.
- **Processors live in `WorkerModule`** (`src/worker.module.ts`), never in a
  module `AppModule` imports, or the API process would consume jobs.
- **A job without a request still needs merchant context.** Under `FORCE` RLS
  the runtime role sees no rows without `withMerchant`, so "no row" is not
  evidence of anything until the query ran under the right merchant.
- **A composite `ON DELETE SET NULL` must name its column**
  (`SET NULL (image_id)`), or it nulls `merchant_id` too. drizzle-kit cannot
  model the list, so such a key lives in a `db:custom` migration, as
  `product_variant_image_fk` does.

## Messenger webhooks

- **The HMAC is computed over the unparsed body.** `bodyParser: { rawBody: true }`
  in `src/modules/auth/auth.module.ts` (Nest's own parser is off) and
  `verifyMetaSignature` (`src/modules/messenger/signature.ts`) are
  load-bearing: any middleware that reparses or re-stringifies the body breaks
  verification. The comparison uses
  `timingSafeEqual` against a length check — keep it that way.
- `parseInboundJobs` turns a customer's text into a `customer-message` job and
  an echo (`is_echo`) into a `page-echo` job. The ingest drops an echo carrying
  our `META_APP_ID` (our own send, already stored by the sender); any other
  echo is the seller replying from Facebook's inbox, stored as `sender = seller`,
  and **pauses the bot** rather than being customer input.
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
  `extractOrder()` wrapper (not built yet; its output schema is in
  `packages/shared/src/schemas/llm.ts`). Provider and model come from env — `LLM_PROVIDER`,
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
- **The pino `redact` list in `src/app.module.ts`** covers the `authorization`,
  `cookie` and `x-hub-signature-256` request headers, the `set-cookie` response
  header, and any `*.accessToken`, `*.pageAccessToken`, `*.userToken`,
  `*.password`, `*.newPassword`, `*.token` or `*.secretAccessKey` field. **Extend it whenever you add a new secret-bearing
  field** — redaction is opt-in, so a new field name is unredacted by default.

## Validation

`ZodValidationPipe` (`src/common/zod-validation.pipe.ts`) validates request
bodies against the **same schemas from `@app/shared`** that back the SPA's forms
and the LLM's output. Don't hand-write a parallel DTO class — derive from the
shared schema instead. Run `pnpm --filter @app/shared build` after changing one,
or the API typechecks against the stale build.

## Testing

- Jest runs as **ESM** (`NODE_OPTIONS=--experimental-vm-modules`, ts-jest ESM
  preset). Relative imports in specs are extensionless too.
- **Specs live in a colocated `__tests__/` directory**, never as a sibling file.
- **Focus, per `docs/architecture/tech-stack.md`: the state machine, tenant isolation, and extraction
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
      `FORCE` added in a `db:custom` migration for a new tenant table;
      Better Auth tables generated.
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
- [ ] New or changed routes carry OpenAPI decorators (`rest-api-design`
      §"OpenAPI in this repo"); anonymous routes declare `security: []`.
- [ ] New/changed code has specs under a `__tests__/` directory, including a
      two-merchant isolation test where business data is involved.
- [ ] Relative imports carry no file extension.
