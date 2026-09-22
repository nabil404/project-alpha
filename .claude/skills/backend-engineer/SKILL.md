---
name: backend-engineer
description: Backend engineering conventions for apps/api, the NestJS API and worker behind the Messenger-to-Order MVP (Kysely, Atlas migrations, BullMQ + Redis, Better Auth, Meta Messenger webhooks, LLM order extraction). Use this skill for ANY backend work — writing a repository or query, changing the schema, adding a module, wiring a queue job, handling a webhook, calling the LLM, or adding config. Trigger it even when the user doesn't name the stack explicitly. Calling the LLM inside a database transaction, or a repository method that forgets merchantId, is a stuck connection pool or a cross-seller data leak rather than a style nit, so consult this before writing code rather than after.
---

# Backend Engineer

Backend conventions for **`apps/api`** — the NestJS API and background worker
behind the Messenger-to-Order MVP. Stack is **NestJS 12 · TypeScript · Postgres

- Kysely · Atlas migrations · BullMQ + Redis · Better Auth · Zod**.

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
- **Kysely is pinned to an exact version** (pre-1.0). Read the release notes
  before bumping it; minor releases carry breaking type changes.
- The global route prefix is `api`, with `/health` excluded (`src/main.ts`).
- **There are no business endpoints yet.** The only controllers in the repo are
  health and the Messenger webhook, so there is no existing request → guard →
  repository path to copy. The conventions below are the pattern to establish.
- **`no-console` is an eslint rule** with `warn`/`error` allowed. It exists
  because tokens must never reach the logs — see Config and secrets.

### This codebase is still greenfield — expect empty files

`db/schema.sql` is eight section headers with **no DDL yet**, `db/migrations/`
holds only `.gitkeep`, and `src/database/database.types.ts` is literally
`export interface DB {}`. Kysely's types only appear after the first
`db:diff` → `db:apply` → `db:types` loop, so until then `DB` is empty and every
table you reference has to come with the migration that creates it. Don't
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
  makes the whole boundary bypassable. One organization per seller for the MVP.

> **Current state — not wired yet.** `TenantGuard` is not registered: there is
> no `APP_GUARD` binding and no `@UseGuards`, and the only occurrence of the
> symbol is its own declaration. Nothing populates `request.session` either,
> because **Better Auth has no HTTP handler mounted** — the `AUTH` provider is
> built in `src/auth/auth.module.ts` and injected nowhere, so there is no
> `/api/auth/*` and no session cookie. Wire all three before relying on
> `request.merchantId`. Until then this section describes the intended
> mechanism, not a running one.

- **The guard is a convenience, not the boundary.** Repositories still take
  `merchantId` explicitly and filter on it. The contract already exists in
  `src/database/base.repository.ts`:

```ts
export type Executor = Kysely<DB> | Transaction<DB>;
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
  a cross-seller collision and an information leak.

- **Required test, per AGENTS.md:** two merchants, proving one can never read,
  update, or confirm the other's data. Write it for every repository, not once.

### Row-level security (the hardening layer — not yet active)

RLS is the chosen defense-in-depth direction on top of the `merchant_id` filter.
Because no tables exist yet, policies go into the first migration rather than
being retrofitted. The shape, per business table:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE  ROW LEVEL SECURITY;
CREATE POLICY orders_merchant_isolation ON orders
  USING      (merchant_id = current_setting('app.current_merchant', true)::uuid)
  WITH CHECK (merchant_id = current_setting('app.current_merchant', true)::uuid);
```

> ⚠️ **RLS is inert today. Do not treat a policy as protection until all four
> prerequisites below are in place — the real boundary is still the
> application-level `merchant_id` filter.**
>
> 0. **Auth and session wiring.** Without a session there is no `merchantId` to
>    put in `set_config`, so there is nothing to exercise RLS with. See the
>    current-state note above — this comes first.
> 1. **The app must stop connecting as a superuser.** Local compose and CI both
>    use `POSTGRES_USER: app`, which is a superuser, and `DATABASE_URL` connects
>    as it. **Superusers bypass RLS unconditionally** — `FORCE` does not change
>    that. (`FORCE` closes the table _owner_ bypass, which is a different
>    thing.) A separate non-superuser runtime role is required — and that means
>    more than `CREATE ROLE`: `GRANT`s on every table **including Better Auth's**,
>    `USAGE` on sequences, and `ALTER DEFAULT PRIVILEGES` so future tables are
>    covered without a manual step each time.
> 2. **Two connection strings.** Atlas keeps migrating as the owner while the app
>    connects restricted, so `.env.example`, `env.schema.ts`, the dev compose
>    file and CI all follow. Which one keeps the name `DATABASE_URL` is a
>    deliberate choice — `atlas.hcl` reads it today, so either Atlas keeps it and
>    the app gets a new variable, or the reverse. Pick once and be consistent.
> 3. **A context gate.** The policy reads a transaction-local setting, so
>    something must run `set_config('app.current_merchant', $1, true)` on the
>    same pinned connection as the queries — a small `withMerchant(db, id, fn)`
>    helper wrapping `db.transaction().execute(...)`. It does not exist yet.
>
>    **Consequence worth deciding on deliberately:** `set_config(..., true)` is
>    transaction-local, so the gate must wrap **every business query, reads
>    included** — simple reads that need no transaction today would acquire one.
>    Setting it non-locally instead is not an option: pooled connections are
>    reused, so the value would bleed from one merchant's request into another's.
>    Budget for the extra concurrent transactions against `DATABASE_POOL_MAX` and
>    the already-configured `idle_in_transaction_session_timeout`.

### Authoring the policies (no Atlas Pro needed)

**RLS is a plain PostgreSQL feature — free, built in, no vendor.** What _is_
Pro-gated is only Atlas's ability to diff policies declaratively out of
`schema.sql`. That splits the schema loop in two:

| Concern                        | Path                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Tables, columns, indexes       | `db/schema.sql` → `pnpm db:diff` (unchanged)                                      |
| Policies, runtime role, grants | `atlas migrate new rls_<table>` → hand-authored SQL → `pnpm --filter api db:hash` |

`atlas migrate new` is the documented route for DDL Atlas doesn't model on the
free tier (the same one used for triggers and views). Atlas still owns creation,
ordering, `atlas.sum` integrity, and apply — so this is **not** the "hand-edit a
generated migration" that `AGENTS.md` forbids.

**The tradeoff:** `schema.sql` stops being the complete desired state, so
`migrate diff` can no longer detect policy drift. Cover that with a
**`db:verify-rls` script** — query `pg_class` / `pg_policies` for every table
carrying a `merchant_id` column and fail if any is missing `ENABLE`, `FORCE`, or
a policy. Run it after `db:apply` and in CI. It is a backstop that catches a
forgotten migration; it does not replace writing one.

## Database: Kysely and Atlas

- **Atlas is the only tool that changes the schema.** Never hand-edit a
  _generated_ migration, never apply DDL directly, never reach for a sync/push
  mode. The loop is: edit `db/schema.sql` → `pnpm db:diff` → **review the
  migration by hand** (especially renames) → `pnpm --filter api db:lint` →
  `pnpm db:apply` → `pnpm db:types`.
  The one sanctioned exception is DDL Atlas does not diff on the free tier —
  RLS policies, roles, grants — which is authored with `atlas migrate new` and
  then `pnpm --filter api db:hash`. Atlas still owns ordering, `atlas.sum`
  integrity, and apply; see the RLS section above.
- `src/database/database.types.ts` is **generated by kysely-codegen from the
  migrated database** — never edited by hand. CI applies migrations to a fresh
  Postgres, reruns codegen, and fails on drift.
- `db:lint` is an Atlas Pro feature and needs `atlas login`; CI runs it only when
  an `ATLAS_TOKEN` secret exists. **Hand review is the constant either way.**
- **Better Auth owns the `user`, `session`, `account` and `verification` tables
  and the organization tables.** Generate their SQL with
  `pnpm --filter api db:auth-schema` and paste it into the auth section of
  `schema.sql` — never hand-write or hand-edit those tables.
- **Money is integer minor units** (paisa/cents), never a float or `numeric`.
  Use the `@app/shared` helpers rather than dividing inline.
- **`jsonb` columns are parsed with Zod on read.** A column typed `unknown` by
  codegen is not validation.
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
- **Per-customer message ordering** comes from a Kysely `.forUpdate()` row lock
  on the conversation inside a short transaction. Combined with invariant #1:
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
  same-origin `/api` client and the shared Zod schemas.
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
- [ ] Schema changed only through the Atlas loop; migration reviewed by hand;
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
