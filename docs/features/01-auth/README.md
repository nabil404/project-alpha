# 01 · Authentication

How a seller gets an account, signs in, and ends up scoped to their own shop.
Scope comes from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model); this page
describes how it is built.

**Status (Sep 2026):** the API side is implemented and covered by an HTTP-level
e2e spec. Not built yet: the SPA's sign-in, sign-up and reset screens, the
explicit Facebook linking UI in account settings, and the Facebook Page
connection flow (see [Not yet built](#not-yet-built)).

## At a glance

| Concern            | Decision                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| Library            | Better Auth, mounted in NestJS through `@thallesp/nestjs-better-auth`                |
| Storage            | Our own Postgres, sharing the API's Drizzle instance and pool                        |
| Sign-in methods    | Email/password (verified email required), Google, Facebook                           |
| Session            | Cookie `better-auth.session_token`, same origin as the SPA                           |
| Tenant             | One organization per seller, created at signup; `activeOrganizationId` on session    |
| Default route rule | Every route needs a session; public routes opt out with `@AllowAnonymous()`          |
| Mount point        | `/api/v1/auth/*`                                                                     |
| Errors             | Better Auth's errors rewritten into the API's `{ error: { code, message, params } }` |

## Sign-in methods

Configured in [`auth.config.ts`](../../../apps/api/src/auth/auth.config.ts).

- **Email and password.** Email verification is required before the first
  sign-in. Password length is 8–128, defined once in
  [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts)
  (`PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `passwordSchema`). Better Auth
  and the SPA's forms both read these constants, so a form can never accept a
  password the server will reject.
- **Google.** Sign-in and sign-up in one step.
- **Facebook.** Sign-in asks for `public_profile` and `email` only. Page
  permissions (`pages_messaging` and related) are **not** requested here. They
  belong to the separate Page connection step, so signing in never shows a
  seller the long Page-permissions consent screen.

Google and Facebook credentials are optional env vars. Without them the API
still boots, and the email/password flows keep working.

### Account linking

`account.accountLinking.trustedProviders` is `['google']`:

- **Google links automatically** to an existing account with the same email,
  because Google guarantees the email is verified.
- **Facebook never links automatically.** Facebook does not guarantee a
  verified email, so matching on it would let someone take over an account by
  registering the victim's address on Facebook. A Facebook identity joins an
  existing account only when the seller links it explicitly from account
  settings.

## Email and password flows

The SPA drives these through Better Auth's endpoints. The callback paths below
are the SPA's side of the contract. All mail is sent through `Mailer.dispatch`
(fire-and-forget, so a slow SMTP server never delays an auth response), using
the templates in
[`modules/mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts).

### Sign-up and verification

1. SPA → `POST /api/v1/auth/sign-up/email` with `callbackURL: '/'`.
2. The user row is created (which creates the seller's organization, see
   [below](#the-sellers-organization)) and a **"Verify your email address"**
   mail is sent. The link is valid for 24 hours (`VERIFICATION_TOKEN_TTL`).
3. The link hits `GET /api/v1/auth/verify-email?token=…`, which marks the email
   verified, **signs the seller in** (`autoSignInAfterVerification`) and
   redirects to `/`.
4. A tampered or expired link redirects to `/?error=INVALID_TOKEN` or
   `/?error=TOKEN_EXPIRED` instead. Called without a callback, it answers with
   `AUTH_INVALID_TOKEN` in the error envelope.

**Signing in before verifying** returns `AUTH_EMAIL_NOT_VERIFIED` and sends a
fresh verification link (`sendOnSignIn`), so the seller is never stuck with an
expired one.

**Signing up with an email that already has an account** gets the same answer as
a new sign-up, so the form can't be used to find out which addresses are
registered. The real owner receives a **"You already have an account"** mail
pointing to `/sign-in`.

### Sign-in and sign-out

- `POST /api/v1/auth/sign-in/email`. A wrong email or password returns
  `AUTH_INVALID_CREDENTIALS`, with no hint about which of the two was wrong.
- `POST /api/v1/auth/sign-out` ends the session.

### Password reset

1. SPA → `POST /api/v1/auth/request-password-reset` with
   `redirectTo: '/reset-password'`. An unknown email gets exactly the same
   answer as a known one.
2. The **"Reset your password"** mail link is valid for **1 hour**
   (`RESET_PASSWORD_TOKEN_TTL`, shorter than verification because this link is
   more dangerous) and works once.
3. The link lands on `/reset-password?token=…` (or `?error=INVALID_TOKEN`).
   That page sends `POST /api/v1/auth/reset-password` with `{ token,
newPassword }`.
4. A successful reset **revokes every existing session**
   (`revokeSessionsOnPasswordReset`). Resetting is how a seller takes an account
   back from someone who got into it, so any session that person holds has to
   end.

## The seller's organization

Every business table's `merchant_id` references `organization(id)`, never
`user(id)`. A seller with no organization has no merchant, and every request
they make would be rejected. Two Better Auth database hooks in `auth.config.ts`
make sure that can't happen:

| Hook                    | Calls                                     | Effect                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user.create.after`     | `ensureOrganizationForUser(db, user)`     | Creates the seller's organization (name = seller's name, slug = its id) and a `member` row with role `owner`. Runs only on user **creation**, so a Google sign-in that links to an existing account reuses that seller's shop. |
| `session.create.before` | `ensureOrganizationForUserId(db, userId)` | Puts `activeOrganizationId` on every new session. The plugin marks that field `input: false`, so a client can't set it. It has to be resolved here, or it stays null.                                                          |

Both functions live in
[`database/ensure-organization.ts`](../../../apps/api/src/database/ensure-organization.ts)
and are **idempotent on purpose**. The `user.create.after` hook runs after the
user row is committed, so if it fails, the user is left with no organization.
The session hook calls the same logic again at the next sign-in and repairs that
account, instead of leaving the seller locked out with a permanent 403.
Concurrent calls are serialised by a `SELECT … FOR UPDATE` on the user row
followed by a membership re-check. A unique constraint on `member.userId` would
have been simpler, but it would rule out the multiple organizations the model is
meant to allow.

The first membership (ordered by `createdAt`, then `id`) is the active one, so
the choice stays stable once a seller can hold several. There is no switcher
yet. Adding one needs no migration.

## Request pipeline

```
request
  │
  ▼
ThrottlerGuard   (global, 120 req / 60 s, Redis-backed)
  │
  ▼
SessionGuard     (global) ── no session ──▶ 401 AUTH_UNAUTHENTICATED
  │                           (skipped for @AllowAnonymous(), e.g. /health, Meta webhooks)
  ▼
TenantGuard      (per controller) ── no activeOrganizationId ──▶ 403 TENANT_NO_ACTIVE_MERCHANT
  │   sets request.merchantId
  ▼
handler → repository(merchantId, …) → withMerchant(db, merchantId, tx => …)
```

- [`SessionGuard`](../../../apps/api/src/auth/session.guard.ts) extends the
  library's `AuthGuard` only to add a code to the rejection. The SPA relies on
  `AUTH_UNAUTHENTICATED` to know when to send the seller to sign-in. It is
  registered in [`app.module.ts`](../../../apps/api/src/app.module.ts) in place
  of the library's own global guard (`disableGlobalAuthGuard: true`).
- [`TenantGuard`](../../../apps/api/src/common/tenant.guard.ts) reads
  `request.session.session.activeOrganizationId`. It is the first layer of
  tenant isolation, not the only one. Repositories still take `merchantId` and
  filter by it, and
  [`withMerchant`](../../../apps/api/src/database/with-merchant.ts) sets the
  transaction-local `app.current_merchant` that row-level security policies
  check, as a backstop.

## HTTP surface

Better Auth is mounted at **`/api/v1/auth/*`** by
[`auth.module.ts`](../../../apps/api/src/auth/auth.module.ts). The `basePath` is
a literal (`'/api/v1/auth'`), not derived from the API version. It is Better
Auth's contract, so it doesn't change if the API moves to a future `/api/v2`.
`baseURL` is `APP_URL`: Caddy serves the SPA and proxies `/api` on the same
origin, which is why the session cookie needs no CORS setup.

Endpoints the flows above use:

| Method | Path                                  | Used for                                    |
| ------ | ------------------------------------- | ------------------------------------------- |
| POST   | `/api/v1/auth/sign-up/email`          | Email sign-up                               |
| GET    | `/api/v1/auth/verify-email?token=…`   | The emailed verification link               |
| POST   | `/api/v1/auth/sign-in/email`          | Email sign-in                               |
| POST   | `/api/v1/auth/sign-in/social`         | Start Google / Facebook sign-in             |
| POST   | `/api/v1/auth/sign-out`               | Sign out                                    |
| POST   | `/api/v1/auth/request-password-reset` | Forgot password                             |
| POST   | `/api/v1/auth/reset-password`         | Set the new password with the emailed token |
| GET    | `/api/v1/auth/get-session`            | Current `{ session, user }`                 |

The full list, merged with our own controllers, is in Swagger at
http://localhost:5173/api/docs (development only). Open it **through the Vite
proxy**. Better Auth trusts only `APP_URL`, so "Try it out" from
`localhost:3000` fails every auth call with `INVALID_ORIGIN`. Better Auth's own
schema endpoint and Scalar page are disabled in every environment. See
[`openapi/openapi.ts`](../../../apps/api/src/openapi/openapi.ts).

**Side effect on the rest of the API.** Better Auth reads the raw request
itself, so Nest's own body parser is off. The auth module re-adds JSON and
urlencoded parsing for every other route, and `bodyParser: { rawBody: true }`
keeps `req.rawBody` available for the Messenger webhook's signature check.
`rawBody: true` on `NestFactory` no longer has any effect.

## Errors

Better Auth writes its errors straight to the response, bypassing
`AllExceptionsFilter`. An after-hook in `auth.config.ts` passes each one through
[`toAuthErrorBody`](../../../apps/api/src/auth/auth-errors.ts), so the SPA
parses `/api/v1/auth/*` errors exactly like errors from any other endpoint.
Redirects (302) pass through untouched.

| Better Auth code                           | Leaves the API as                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_EMAIL_OR_PASSWORD`                | `AUTH_INVALID_CREDENTIALS`                                                                                                          |
| `EMAIL_NOT_VERIFIED`                       | `AUTH_EMAIL_NOT_VERIFIED`                                                                                                           |
| `INVALID_TOKEN`, `TOKEN_EXPIRED`           | `AUTH_INVALID_TOKEN`                                                                                                                |
| `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` | `VALIDATION_FAILED`, field `password` (or `newPassword` on `/reset-password`, `/change-password`), code `MIN_LENGTH` / `MAX_LENGTH` |
| `INVALID_EMAIL`                            | `VALIDATION_FAILED`, field `email`, code `INVALID_FORMAT`                                                                           |
| `VALIDATION_ERROR`                         | `VALIDATION_FAILED`, fields parsed back out of the message (`[body.email] …`)                                                       |
| any other 401                              | `AUTH_UNAUTHENTICATED`                                                                                                              |
| anything else                              | `HTTP_<status>`, the same fallback the global filter uses                                                                           |

Adding a new auth `ErrorCode` touches three files:
`packages/shared/src/errors/codes.ts`, `apps/web/src/i18n/error-keys.ts` and
`apps/web/src/i18n/locales/en/errors.json` (see `AGENTS.md`).

## Data

Better Auth owns seven tables: `user`, `session`, `account`, `verification`
(core), and `organization`, `member`, `invitation` (Organization plugin). Their
Drizzle schema is generated into
[`database/schema/auth.ts`](../../../apps/api/src/database/schema/auth.ts) by:

```bash
pnpm --filter api db:auth-schema
```

and then migrated through drizzle-kit like any other table (`db:generate` →
review → `db:migrate`), so auth schema changes are versioned and reviewed.
The CLI entry point, [`auth.cli.ts`](../../../apps/api/src/auth/auth.cli.ts),
builds the same config against `drizzle.mock()`, so generating the schema needs
no database or credentials.

These tables are granted to the restricted `app_runtime` role in
[`0001_rls_runtime_role.sql`](../../../apps/api/db/migrations/0001_rls_runtime_role.sql),
but they **must never get an RLS policy**. They carry no `merchant_id`, and the
session lookup happens before any merchant context exists, so a policy would
lock out sign-in itself.

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/config/env.schema.ts),
set in `apps/api/.env`:

| Variable                                       | Required | Notes                                                                  |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `APP_URL`                                      | yes      | The SPA origin; Better Auth's `baseURL` and its only trusted origin    |
| `BETTER_AUTH_SECRET`                           | yes      | At least 32 characters; signs sessions and tokens                      |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | no       | Google sign-in                                                         |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | no       | Facebook sign-in                                                       |
| `SMTP_URL`, `MAIL_FROM`                        | yes      | Verification and reset mail; locally Mailpit (`smtp://localhost:1025`) |

Locally, `pnpm dev:up` starts Mailpit, and the emails show up at
http://localhost:8025.

## Security notes

- **No account enumeration.** Sign-up with a taken email and a reset request for
  an unknown email both look exactly like the success case.
- **Reset ends every session.** Taking back a compromised account signs the
  intruder out.
- **Nothing sensitive in logs.** Better Auth's logger is routed into pino at
  `warn`, because at `info` it logs the address behind a duplicate sign-up. A
  failed send logs only the subject and the recipient's domain, since the mail
  body contains a single-use token.
- **Tenant isolation doesn't rely on the client.** `activeOrganizationId` is
  set on the server and can't be supplied by the client. It is checked by
  `TenantGuard`, filtered on by every repository, and enforced by RLS as a
  backstop.

## Tests

| Spec                                                                                                                     | Covers                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [`auth/__tests__/email-password.e2e.spec.ts`](../../../apps/api/src/auth/__tests__/email-password.e2e.spec.ts)           | Every email/password flow above over real HTTP, organization resolution, mount point, raw-body preservation |
| [`auth/__tests__/auth-errors.spec.ts`](../../../apps/api/src/auth/__tests__/auth-errors.spec.ts)                         | The error mapping table                                                                                     |
| [`database/__tests__/ensure-organization.spec.ts`](../../../apps/api/src/database/__tests__/ensure-organization.spec.ts) | Organization bootstrap and its idempotency                                                                  |

The e2e spec needs a real Postgres and is **skipped** unless
`DATABASE_ADMIN_URL` is set. CI sets it. Locally:

```bash
pnpm dev:up
```

```bash
DATABASE_ADMIN_URL=postgres://… pnpm --filter api test -- auth
```

## Not yet built

- **SPA screens:** sign-in, sign-up, forgot password, `/reset-password`, and
  handling of `/?error=…` after a verification link. `apps/web` has no auth
  routes yet.
- **Account settings:** explicit Facebook linking, and change password (the
  error mapping already handles `/change-password`).
- **Page connection:** the separate step that requests Page permissions and
  stores the encrypted Page token. It gets its own feature doc.
- **Organization switcher:** deferred. The data model already supports several
  organizations per seller.

## Key files

- [`apps/api/src/auth/auth.config.ts`](../../../apps/api/src/auth/auth.config.ts): the whole Better Auth configuration
- [`apps/api/src/auth/auth.module.ts`](../../../apps/api/src/auth/auth.module.ts): mounting, body parser
- [`apps/api/src/auth/session.guard.ts`](../../../apps/api/src/auth/session.guard.ts): global session requirement
- [`apps/api/src/auth/auth-errors.ts`](../../../apps/api/src/auth/auth-errors.ts): error envelope mapping
- [`apps/api/src/auth/auth.cli.ts`](../../../apps/api/src/auth/auth.cli.ts): schema-generation entry point
- [`apps/api/src/common/tenant.guard.ts`](../../../apps/api/src/common/tenant.guard.ts): merchant resolution
- [`apps/api/src/database/ensure-organization.ts`](../../../apps/api/src/database/ensure-organization.ts): organization bootstrap
- [`apps/api/src/database/schema/auth.ts`](../../../apps/api/src/database/schema/auth.ts): generated auth tables
- [`apps/api/src/modules/mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts): auth emails
- [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts): password rules
