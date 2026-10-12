# 01 · Authentication

How a seller gets an account, signs in, and ends up scoped to their own shop.
Scope comes from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model). This page
describes how it is built.

**Status, October 2026.** The API side is complete, and an HTTP-level e2e spec
covers it. The SPA has sign-in (`/sign-in`, with Google and Facebook), sign-up
(`/sign-up`), forgot password (`/forgot-password`), and reset password
(`/reset-password`). [Settings – Account](../08-settings-account/README.md)
covers linking and unlinking Google or Facebook, changing the password, and
signing devices out. [03 · Connect Facebook Page](../03-facebook-page/README.md)
covers connecting a Facebook Page. [Not yet built](#not-yet-built) lists what
is left.

## At a glance

| Concern            | Decision                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Library            | Better Auth, mounted in NestJS through `@thallesp/nestjs-better-auth`                       |
| Storage            | Our own Postgres, sharing the API's Drizzle instance and pool                               |
| Sign-in methods    | Email and password (verified email required), Google, Facebook                              |
| Session            | Cookie `better-auth.session_token`, same origin as the SPA                                  |
| Tenant             | One organization per seller, created at sign-up. The session carries `activeOrganizationId` |
| Default route rule | Every route needs a session. A public route opts out with `@AllowAnonymous()`               |
| Mount point        | `/api/v1/auth/*`                                                                            |
| Errors             | Better Auth's errors rewritten into the API's `{ error: { code, message, params } }`        |

## Sign-in methods

[`auth.config.ts`](../../../apps/api/src/modules/auth/auth.config.ts) configures
all three methods.

- **Email and password.** The seller must verify their email before the first
  sign-in. A password is 8 to 128 characters. The limits are defined once in
  [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts)
  (`PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `passwordSchema`). Better Auth
  and the SPA's forms both read these constants, so a form never accepts a
  password the server rejects.
- **Google.** One step signs the seller up or signs them in.
- **Facebook.** Sign-in asks for `public_profile` and `email` only. It does not
  request Page permissions such as `pages_messaging`. Those belong to the
  separate Page connection step, so signing in never shows a seller the long
  Page-permissions consent screen.

The Google and Facebook credentials are optional env vars. Without them, the
API still boots and the email and password flows keep working.

### Account linking

`account.accountLinking.trustedProviders` is `['google']`.

- **Google links automatically** to an existing account with the same email,
  because Google guarantees the email is verified.
- **Facebook never links automatically.** Facebook does not guarantee a
  verified email. Matching on it would let an attacker take over an account by
  registering the victim's address on Facebook. A Facebook identity joins an
  existing account only when the seller links it from
  [Settings – Account](../08-settings-account/README.md#sign-in-methods).
  Signing in with a Facebook account whose email already has an account
  redirects with `?error=AUTH_ACCOUNT_NOT_LINKED`.

When an OAuth sign-in fails, Better Auth's callback redirects with
`?error=<snake_case>`. `toOAuthErrorLocation` in
[`auth-errors.ts`](../../../apps/api/src/modules/auth/auth-errors.ts) replaces
that value with an `ErrorCode` and drops `error_description`.

| Better Auth `error`                        | Rewritten to                 | When                         |
| ------------------------------------------ | ---------------------------- | ---------------------------- |
| `account_not_linked`                       | `AUTH_ACCOUNT_NOT_LINKED`    | Facebook email already taken |
| `access_denied`                            | `AUTH_SOCIAL_CANCELLED`      | The seller declined consent  |
| `email_does_not_match`                     | `AUTH_SOCIAL_EMAIL_MISMATCH` | Linking                      |
| `account_already_linked_to_different_user` | `AUTH_SOCIAL_ACCOUNT_TAKEN`  | Linking                      |
| anything else                              | `AUTH_SOCIAL_FAILED`         |                              |

## Email and password flows

The SPA drives these flows through Better Auth's endpoints. The callback paths
below are the SPA's side of the contract.

`Mailer.dispatch` sends every email without waiting for delivery, so a slow
SMTP server never delays an auth response. The templates live in
[`modules/mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts).
Each email has a plain-text part and an HTML part. The HTML part is built with
[MJML](https://mjml.io) from the shared layout in
[`modules/mail/layout.ts`](../../../apps/api/src/modules/mail/layout.ts), whose
look and copy follow the email designs on the dashboard's design canvas.

MJML compiles every template once, when the module loads, with strict
validation. A broken template therefore fails startup and the specs. The parts
that differ per message, such as a link or a name, are slots that receive an
escaped value at send time. Sending an email never runs MJML, so every auth
path pays the same rendering cost.

### Sign-up and verification

1. The SPA sends `POST /api/v1/auth/sign-up/email` with `name`, `shopName`,
   `email`, `phone`, `password`, and `callbackURL: '/'`. A `before` hook
   validates the body against `signUpSchema` from `@app/shared`, the same
   schema the SPA's form uses. An invalid body gets `VALIDATION_FAILED` with
   per-field errors before Better Auth sees it, because Better Auth checks only
   the fields it knows about.
2. Better Auth creates the user row with `phone`. The API checks the number
   against its country's numbering plan and stores it in E.164. `phone` is a
   Better Auth `additionalFields` column, nullable because a social sign-up has
   no phone. Rows from before this check keep the number as it was typed.
   The form's calling-code picker starts at the country of the browser's time
   zone (`countryOfTimeZone`), because no shop exists yet to take a country
   from.
3. The API creates the seller's organization, named after `shopName` (see
   [The seller's organization](#the-sellers-organization)), in the region of
   the phone's country
   ([Settings – General](../06-settings-general/README.md#rules)).
4. The API sends a "Verify your email address" email. The link is valid for
   24 hours (`VERIFICATION_TOKEN_TTL`).
5. The link opens `GET /api/v1/auth/verify-email?token=…`. That endpoint marks
   the email verified, signs the seller in (`autoSignInAfterVerification`), and
   redirects to `/`.
6. A tampered or expired link redirects to `/?error=INVALID_TOKEN` or
   `/?error=TOKEN_EXPIRED` instead. A request without a callback gets
   `AUTH_INVALID_TOKEN` in the error envelope.

A seller who signs in before verifying gets `AUTH_EMAIL_NOT_VERIFIED`, and the
API sends a fresh verification link (`sendOnSignIn`). An expired link never
leaves the seller stuck.

Signing up with an email that already has an account gets the same answer as a
new sign-up, so nobody can use the form to find out which addresses are
registered. The real owner receives a "You already have an account" email that
links to both `/sign-in` and `/forgot-password`.

### Sign-in and sign-out

- `POST /api/v1/auth/sign-in/email` signs the seller in. A wrong email or
  password returns `AUTH_INVALID_CREDENTIALS`, with no hint about which of the
  two was wrong.
- `POST /api/v1/auth/sign-out` ends the session.

### Password reset

1. The SPA sends `POST /api/v1/auth/request-password-reset` with
   `redirectTo: '/reset-password'`. An unknown email gets the same answer as a
   known one.
2. The API sends a "Reset your password" email. Its link works once and is
   valid for 1 hour (`RESET_PASSWORD_TOKEN_TTL` in `@app/shared`, which the SPA
   also shows). The window is shorter than verification's because a reset link
   can take over an account.
3. The link opens `/reset-password?token=…`, or `/reset-password?error=INVALID_TOKEN`
   for a bad token. That page sends `POST /api/v1/auth/reset-password` with
   `{ token, newPassword }`.
4. A successful reset revokes every existing session
   (`revokeSessionsOnPasswordReset`). A reset is how a seller takes an account
   back from an intruder, so every session the intruder holds has to end.

## The seller's organization

Every business table's `merchant_id` references `organization(id)`, never
`user(id)`. A seller with no organization has no merchant, and the API rejects
every request they make. Two Better Auth database hooks in `auth.config.ts`
make sure every seller has an organization.

| Hook                    | Calls                                                                                              | Effect                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `user.create.after`     | `ensureOrganizationForUser(db, user, shopName)`, then `seedRegionFromPhone(db, merchantId, phone)` | Creates the organization, the owner membership, and the shop region |
| `session.create.before` | `ensureOrganizationForUserId(db, userId)`                                                          | Puts `activeOrganizationId` on every new session                    |

`user.create.after` names the organization after the sign-up's `shopName`, or
after the seller's name for a social sign-up. The slug is the organization's
id. The hook also adds a `member` row with role `owner`. It runs only when
Better Auth creates a user, so a Google sign-in that links to an existing
account reuses that seller's shop. `seedRegionFromPhone` then writes the shop's
`merchant_settings` row in the region of the sign-up phone
([Settings – General](../06-settings-general/README.md#rules)). If that write
fails, the hook logs the error and sign-up still succeeds.

`session.create.before` exists because the Organization plugin marks
`activeOrganizationId` as `input: false`, so a client can't set it. If this hook
did not resolve it, the field would stay null.

Both functions live in
[`database/ensure-organization.ts`](../../../apps/api/src/modules/database/ensure-organization.ts),
and both are idempotent on purpose. `user.create.after` runs after Better Auth
commits the user row. If the hook fails, the user is left with no organization.
At the next sign-in, the session hook runs the same logic and repairs the
account, so the seller is not locked out with a permanent 403.

A `SELECT … FOR UPDATE` on the user row, followed by a second membership check,
serializes concurrent calls. A unique constraint on `member.userId` would be
simpler, but it would rule out the multiple organizations per seller that the
data model allows.

The first membership, ordered by `createdAt` and then `id`, is the active one.
That order stays stable once a seller can hold several organizations. There is
no organization switcher yet, and adding one needs no migration.

## Request pipeline

A request to a Nest controller passes `ThrottlerGuard`, then `SessionGuard`,
then `TenantGuard` before it reaches a handler. Better Auth's own
`/api/v1/auth/*` routes skip all three. The
[request pipeline diagram](request-pipeline.md) shows each guard and the
response it sends when it rejects a request.

- [`SessionGuard`](../../../apps/api/src/modules/auth/session.guard.ts) extends
  the library's `AuthGuard` only to add a code to the rejection. The SPA reads
  `AUTH_UNAUTHENTICATED` to know when to send the seller to sign-in.
  [`app.module.ts`](../../../apps/api/src/app.module.ts) registers it in place
  of the library's own global guard (`disableGlobalAuthGuard: true`).
- [`TenantGuard`](../../../apps/api/src/common/tenant.guard.ts) reads
  `request.session.session.activeOrganizationId`. It is the first layer of
  tenant isolation, not the only one. Repositories still take `merchantId` and
  filter by it. As a backstop,
  [`withMerchant`](../../../apps/api/src/modules/database/with-merchant.ts) sets
  the transaction-local `app.current_merchant`, which the row-level security
  policies check.

## HTTP endpoints

[`auth.module.ts`](../../../apps/api/src/modules/auth/auth.module.ts) mounts
Better Auth at `/api/v1/auth/*`. The `basePath` is the literal
`'/api/v1/auth'`, not derived from the API version. It is Better Auth's
contract, so it stays put if the API moves to a future `/api/v2`.

`baseURL` is `APP_URL`. Caddy serves the SPA and proxies `/api` on the same
origin, so the session cookie needs no CORS setup.

The flows above use these endpoints:

| Method | Path                                   | Used for                                    |
| ------ | -------------------------------------- | ------------------------------------------- |
| POST   | `/api/v1/auth/sign-up/email`           | Email sign-up                               |
| GET    | `/api/v1/auth/verify-email?token=…`    | The emailed verification link               |
| POST   | `/api/v1/auth/sign-in/email`           | Email sign-in                               |
| POST   | `/api/v1/auth/sign-in/social`          | Start a Google or Facebook sign-in          |
| POST   | `/api/v1/auth/sign-out`                | Sign out                                    |
| POST   | `/api/v1/auth/request-password-reset`  | Forgot password                             |
| POST   | `/api/v1/auth/reset-password`          | Set the new password with the emailed token |
| GET    | `/api/v1/auth/get-session`             | Current `{ session, user }`                 |
| POST   | `/api/v1/auth/send-verification-email` | Resend the verification link                |

Settings – Account also uses `/update-user`, `/change-password`,
`/list-accounts`, `/link-social`, and `/unlink-account`. See
[08 · Settings – Account](../08-settings-account/README.md).

Swagger lists every endpoint, merged with our own controllers, at
http://localhost:5173/api/docs in development only. Open it through the Vite
proxy. Better Auth trusts only `APP_URL`, so "Try it out" from
`localhost:3000` fails every auth call with `INVALID_ORIGIN`. Better Auth's own
schema endpoint and Scalar page are disabled in every environment. See
[`openapi/openapi.ts`](../../../apps/api/src/openapi/openapi.ts).

**Side effect on the rest of the API.** Better Auth reads the raw request
itself, so Nest's own body parser is off. The auth module adds JSON and
urlencoded parsing back for every other route. Its `bodyParser: { rawBody: true }`
keeps `req.rawBody` available for the Messenger webhook's signature check.
Setting `rawBody: true` on `NestFactory` has no effect.

## Errors

Better Auth writes its errors straight to the response and bypasses
`AllExceptionsFilter`. An after-hook in `auth.config.ts` passes each error
through [`toAuthErrorBody`](../../../apps/api/src/modules/auth/auth-errors.ts),
so the SPA parses `/api/v1/auth/*` errors like errors from any other endpoint.
Redirects (302) pass through untouched.

| Better Auth code                        | Leaves the API as                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_EMAIL_OR_PASSWORD`             | `AUTH_INVALID_CREDENTIALS`                                                                                                   |
| `EMAIL_NOT_VERIFIED`                    | `AUTH_EMAIL_NOT_VERIFIED`                                                                                                    |
| `INVALID_TOKEN`, `TOKEN_EXPIRED`        | `AUTH_INVALID_TOKEN`                                                                                                         |
| `PASSWORD_TOO_SHORT`                    | `VALIDATION_FAILED`, code `MIN_LENGTH` on field `password`, or on `newPassword` for `/reset-password` and `/change-password` |
| `PASSWORD_TOO_LONG`                     | `VALIDATION_FAILED`, code `MAX_LENGTH` on the same field as `PASSWORD_TOO_SHORT`                                             |
| `INVALID_EMAIL`                         | `VALIDATION_FAILED`, code `INVALID_FORMAT` on field `email`                                                                  |
| `INVALID_PASSWORD` (`/change-password`) | `AUTH_WRONG_PASSWORD`                                                                                                        |
| `FAILED_TO_UNLINK_LAST_ACCOUNT`         | `AUTH_LAST_SIGN_IN_METHOD`                                                                                                   |
| `SESSION_NOT_FRESH`                     | `AUTH_SESSION_NOT_FRESH`. Unlinking needs a session under a day old                                                          |
| `VALIDATION_ERROR`                      | `VALIDATION_FAILED`, with fields parsed back out of the message (`[body.email] …`), each with code `INVALID_INPUT`           |
| any other 401                           | `AUTH_UNAUTHENTICATED`                                                                                                       |
| anything else                           | `HTTP_<status>`, the same fallback the global filter uses                                                                    |

A new auth `ErrorCode` touches three files:
`packages/shared/src/errors/codes.ts`, `apps/web/src/i18n/error-keys.ts`, and
`apps/web/src/i18n/locales/en/errors.json` (see `AGENTS.md`).

## Data

Better Auth owns seven tables. `user`, `session`, `account`, and
`verification` come from its core. `organization`, `member`, and `invitation`
come from the Organization plugin.

`user` carries two `additionalFields` of ours:

- `phone`, in E.164, null for a social sign-up.
- `locale`, the dashboard language. Only `PATCH /api/v1/account/preferences`
  sets it, and Better Auth's `/update-user` refuses it.

`user.image` is the profile photo, and `organization.logo` is the shop logo.

To regenerate the Drizzle schema for these tables into
[`database/schema/auth.ts`](../../../apps/api/src/modules/database/schema/auth.ts),
run:

```bash
pnpm --filter api db:auth-schema
```

Then migrate it through drizzle-kit like any other table: `db:generate`,
review the SQL, `db:migrate`. Auth schema changes are versioned and reviewed
like every other schema change. The CLI entry point,
[`auth.cli.ts`](../../../apps/api/src/modules/auth/auth.cli.ts), builds the
same config against `drizzle.mock()`, so generating the schema needs no
database and no credentials.

These tables are granted to the restricted `app_runtime` role (see
[Database](../../architecture/database.md#roles)), but they must never get an
RLS policy. They carry no `merchant_id`, and the session lookup runs before any
merchant context exists, so a policy would block sign-in itself.

## Configuration

[`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts)
reads these variables from `environments/.env`.

| Variable                                       | Required | Notes                                                                     |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `APP_URL`                                      | yes      | The SPA origin. Better Auth's `baseURL` and its only trusted origin       |
| `BETTER_AUTH_SECRET`                           | yes      | At least 32 characters. Signs sessions and tokens                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | no       | Google sign-in                                                            |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | no       | Facebook sign-in                                                          |
| `SMTP_URL`, `MAIL_FROM`                        | yes      | Verification and reset email. Locally, Mailpit at `smtp://localhost:1025` |

Locally, `pnpm dev:up` starts Mailpit, and the emails show up at
http://localhost:8025.

## Security notes

- **No account enumeration.** Sign-up with a taken email and a reset request for
  an unknown email both look the same as the success case.
- **A reset ends every session.** A seller who takes back a compromised account
  signs the intruder out.
- **Nothing sensitive in logs.** Better Auth's logger writes to pino at `warn`,
  because at `info` it logs the address behind a duplicate sign-up. A failed
  send logs only the subject and the recipient's domain, because the email body
  contains a single-use token.
- **Tenant isolation doesn't rely on the client.** The server sets
  `activeOrganizationId`, and the client can't supply it. `TenantGuard` checks
  it, every repository filters on it, and RLS enforces it as a backstop.

## Tests

| Spec                                                                                                                             | Covers                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`auth/__tests__/email-password.e2e.spec.ts`](../../../apps/api/src/modules/auth/__tests__/email-password.e2e.spec.ts)           | Every email and password flow above over real HTTP, organization resolution, mount point, raw-body preservation |
| [`auth/__tests__/auth-errors.spec.ts`](../../../apps/api/src/modules/auth/__tests__/auth-errors.spec.ts)                         | The error mapping table                                                                                         |
| [`database/__tests__/ensure-organization.spec.ts`](../../../apps/api/src/modules/database/__tests__/ensure-organization.spec.ts) | Organization bootstrap and its idempotency                                                                      |

The e2e spec and the organization spec need a real Postgres. Jest skips them
unless `TEST_DATABASE_ADMIN_URL` is set (see `environments/.env.example`). The
Jest run creates and migrates that database itself, and CI sets the variable.

To run the auth specs locally, set `TEST_DATABASE_ADMIN_URL` in
`environments/.env`, start the local services, and run Jest:

```bash
pnpm dev:up
```

```bash
pnpm --filter api test -- auth
```

## Not yet built

- **Email verified screen.** A successful verification link lands on `/` with
  no confirmation. A failed one (`/?error=…`) lands on sign-in with an error
  banner.
- **Terms and privacy pages.** Sign-up requires agreeing to them, and
  `apps/web/src/features/auth/legal.ts` links `/terms` and `/privacy`. Caddy
  routes those paths to `/legal/*.html`, but the files don't exist yet. The
  server does not record the agreement.
- **Shop name and phone for social sign-ups.** A social sign-up arrives with
  neither. The shop is named after the seller and uses the default region,
  Bangladesh, until its first save in Settings – General.
- **Organization switcher.** Deferred. The data model already supports several
  organizations per seller.

## Key files

- [`apps/api/src/modules/auth/auth.config.ts`](../../../apps/api/src/modules/auth/auth.config.ts): the whole Better Auth configuration
- [`apps/api/src/modules/auth/auth.module.ts`](../../../apps/api/src/modules/auth/auth.module.ts): mounting, body parser
- [`apps/api/src/modules/auth/session.guard.ts`](../../../apps/api/src/modules/auth/session.guard.ts): global session requirement
- [`apps/api/src/modules/auth/auth-errors.ts`](../../../apps/api/src/modules/auth/auth-errors.ts): error envelope mapping
- [`apps/api/src/modules/auth/auth.cli.ts`](../../../apps/api/src/modules/auth/auth.cli.ts): schema-generation entry point
- [`apps/api/src/common/tenant.guard.ts`](../../../apps/api/src/common/tenant.guard.ts): merchant resolution
- [`apps/api/src/modules/database/ensure-organization.ts`](../../../apps/api/src/modules/database/ensure-organization.ts): organization bootstrap
- [`apps/api/src/modules/database/schema/auth.ts`](../../../apps/api/src/modules/database/schema/auth.ts): generated auth tables
- [`apps/api/src/modules/mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts): auth emails
- [`apps/api/src/modules/mail/layout.ts`](../../../apps/api/src/modules/mail/layout.ts): MJML layout and blocks, compiled at load
- [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts): password rules
