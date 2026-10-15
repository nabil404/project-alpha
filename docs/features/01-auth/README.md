# 01 · Authentication

How a seller gets an account, signs in, and is scoped to their own shop. Scope
comes from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model).

**Status (Oct 2026):** the API is complete and covered by an HTTP e2e spec.
The SPA has `/sign-in` (with Google and Facebook), `/sign-up`,
`/forgot-password` and `/reset-password`. Linking providers, changing the
password and signing devices out are in
[Settings – Account](../08-settings-account/README.md); connecting a Page is
[03 · Connect Facebook Page](../03-facebook-page/README.md). See
[Not yet built](#not-yet-built).

## At a glance

| Concern         | Decision                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| Library         | Better Auth, mounted in NestJS through `@thallesp/nestjs-better-auth`                 |
| Storage         | Our Postgres, through the API's Drizzle instance and pool                             |
| Sign-in methods | Email and password (verified email required), Google, Facebook                        |
| Session         | Cookie `better-auth.session_token`, same origin as the SPA                            |
| Tenant          | One organization per seller, created at sign-up; the session's `activeOrganizationId` |
| Default rule    | Every route needs a session; a public route opts out with `@AllowAnonymous()`         |
| Mount point     | `/api/v1/auth/*`                                                                      |
| Errors          | Better Auth's errors rewritten into `{ error: { code, message, params } }`            |

## Sign-in methods

[`auth.config.ts`](../../../apps/api/src/modules/auth/auth.config.ts)
configures all three.

- **Email and password.** The email must be verified before the first
  sign-in. A password is 8 to 128 characters (`PASSWORD_MIN_LENGTH`,
  `PASSWORD_MAX_LENGTH` in
  [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts)),
  and Better Auth and the SPA's forms read the same constants.
- **Google** signs the seller up or in in one step.
- **Facebook** asks for `public_profile` and `email` only. Page permissions
  such as `pages_messaging` belong to the Page connection step, so sign-in
  never shows the long Page consent screen.

The Google and Facebook credentials are optional. Without them the API still
boots, with email and password only.

### Account linking

`account.accountLinking.trustedProviders` is `['google']`.

- **Google links automatically** to an account with the same email, because
  Google guarantees the email is verified.
- **Facebook never links automatically.** It does not guarantee a verified
  email, so matching on it would let an attacker register a victim's address
  on Facebook and take the account. A Facebook identity joins an existing
  account only from
  [Settings – Account](../08-settings-account/README.md#sign-in-methods).
  Signing in with Facebook when the email already has an account redirects
  with `?error=AUTH_ACCOUNT_NOT_LINKED`.

A failed OAuth sign-in redirects with `?error=<snake_case>`.
`toOAuthErrorLocation` in
[`auth-errors.ts`](../../../apps/api/src/modules/auth/auth-errors.ts) swaps
that value for an `ErrorCode` and drops `error_description`.

| Better Auth `error`                        | Rewritten to                 | When                         |
| ------------------------------------------ | ---------------------------- | ---------------------------- |
| `account_not_linked`                       | `AUTH_ACCOUNT_NOT_LINKED`    | Facebook email already taken |
| `access_denied`                            | `AUTH_SOCIAL_CANCELLED`      | The seller declined consent  |
| `email_does_not_match`                     | `AUTH_SOCIAL_EMAIL_MISMATCH` | Linking                      |
| `account_already_linked_to_different_user` | `AUTH_SOCIAL_ACCOUNT_TAKEN`  | Linking                      |
| anything else                              | `AUTH_SOCIAL_FAILED`         |                              |

## Email and password flows

The SPA calls Better Auth's endpoints; the callback paths below are the SPA's
side of the contract.

`Mailer.dispatch` sends without waiting for delivery, so a slow SMTP server
never delays an auth response. The templates in
[`modules/mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts)
each have a plain-text and an HTML part. The HTML comes from
[MJML](https://mjml.io) and the shared layout in
[`modules/mail/layout.ts`](../../../apps/api/src/modules/mail/layout.ts). MJML
compiles every template once at module load with strict validation, so a
broken template fails startup and the specs. Sending only fills escaped
values into slots.

### Sign-up and verification

1. The SPA sends `POST /api/v1/auth/sign-up/email` with `name`, `shopName`,
   `email`, `phone`, `password` and `callbackURL: '/'`. A `before` hook checks
   the body against `signUpSchema` from `@app/shared`, the form's own schema,
   and answers `VALIDATION_FAILED` with field errors. Better Auth alone checks
   only the fields it knows.
2. Better Auth creates the user. `phone` is checked against its country's
   numbering plan and stored as E.164, in a nullable `additionalFields`
   column (social sign-ups have none; older rows keep the number as typed).
   The form's calling-code picker starts at the browser time zone's country
   (`countryOfTimeZone`).
3. The API creates the seller's organization, named `shopName`
   ([below](#the-sellers-organization)), in the region of the phone's country
   ([Settings – General](../06-settings-general/README.md#rules)).
4. The API emails a verification link, valid 24 hours
   (`VERIFICATION_TOKEN_TTL`).
5. `GET /api/v1/auth/verify-email?token=…` marks the email verified, signs the
   seller in (`autoSignInAfterVerification`) and redirects to `/`.
6. A tampered or expired link redirects to `/?error=INVALID_TOKEN` or
   `/?error=TOKEN_EXPIRED`. Without a callback it answers
   `AUTH_INVALID_TOKEN`.

Signing in before verifying answers `AUTH_EMAIL_NOT_VERIFIED` and sends a
fresh link (`sendOnSignIn`), so an expired link never strands the seller.

Signing up with a registered email answers exactly like a new sign-up, so the
form cannot reveal which addresses exist. The owner gets a "You already have
an account" email linking `/sign-in` and `/forgot-password`.

### Sign-in and sign-out

- `POST /api/v1/auth/sign-in/email`. A wrong email or password is
  `AUTH_INVALID_CREDENTIALS`, without saying which.
- `POST /api/v1/auth/sign-out` ends the session.

### Password reset

1. The SPA sends `POST /api/v1/auth/request-password-reset` with
   `redirectTo: '/reset-password'`. An unknown email gets the same answer.
2. The emailed link works once and lasts 1 hour (`RESET_PASSWORD_TOKEN_TTL`
   in `@app/shared`, which the SPA also shows), shorter than verification
   because a reset link can take over an account.
3. It opens `/reset-password?token=…` (or `?error=INVALID_TOKEN`), which sends
   `POST /api/v1/auth/reset-password` with `{ token, newPassword }`.
4. A successful reset revokes every session
   (`revokeSessionsOnPasswordReset`), so an intruder is signed out.

## The seller's organization

Every business table's `merchant_id` references `organization(id)`, never
`user(id)`, and a seller without an organization is refused everywhere. Two
database hooks in `auth.config.ts` guarantee one.

| Hook                    | Calls                                                                                              | Effect                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `user.create.after`     | `ensureOrganizationForUser(db, user, shopName)`, then `seedRegionFromPhone(db, merchantId, phone)` | Creates the organization, the `owner` member, the region |
| `session.create.before` | `ensureOrganizationForUserId(db, userId)`                                                          | Sets `activeOrganizationId` on every new session         |

- The organization is named `shopName`, or the seller's name for a social
  sign-up, and its slug is its id. The hook runs only when Better Auth creates
  a user, so a Google sign-in linked to an existing account keeps that shop.
  If `seedRegionFromPhone` fails, the hook logs it and sign-up succeeds.
- The session hook is needed because the Organization plugin marks
  `activeOrganizationId` as `input: false`; without it the field stays null.
- Both functions, in
  [`database/ensure-organization.ts`](../../../apps/api/src/modules/database/ensure-organization.ts),
  are idempotent. `user.create.after` runs after the user commits, so if it
  fails, the next sign-in's session hook creates the organization instead of
  leaving the seller on a permanent 403.
- A `SELECT … FOR UPDATE` on the user row plus a second membership check
  serializes concurrent calls. A unique `member.userId` would be simpler but
  would forbid several organizations per seller, which the data model allows.
- The active organization is the first membership by `createdAt`, then `id`.
  An organization switcher would need no migration.

## Request pipeline

A request to a Nest controller passes `ThrottlerGuard`, `SessionGuard` and
`TenantGuard` in that order; Better Auth's own `/api/v1/auth/*` routes skip
all three. [Request pipeline](request-pipeline.md) draws each guard and its
rejection.

- [`SessionGuard`](../../../apps/api/src/modules/auth/session.guard.ts)
  extends the library's `AuthGuard` only to add the `AUTH_UNAUTHENTICATED`
  code, which sends the SPA to sign-in.
  [`app.module.ts`](../../../apps/api/src/app.module.ts) registers it instead
  of the library's global guard (`disableGlobalAuthGuard: true`).
- [`TenantGuard`](../../../apps/api/src/common/tenant.guard.ts) reads
  `request.session.session.activeOrganizationId`. It is the first layer of
  tenant isolation: repositories still filter on `merchantId`, and
  [`withMerchant`](../../../apps/api/src/modules/database/with-merchant.ts)
  sets the transaction-local `app.current_merchant` that the row-level
  security policies check.

## HTTP endpoints

[`auth.module.ts`](../../../apps/api/src/modules/auth/auth.module.ts) mounts
Better Auth at the literal `basePath` `'/api/v1/auth'`, which stays put if the
API moves to `/api/v2`. `baseURL` is `APP_URL`; Caddy serves the SPA and
proxies `/api` on one origin, so the cookie needs no CORS.

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
`/list-accounts`, `/link-social` and `/unlink-account`
([08](../08-settings-account/README.md)).

Swagger lists these with our controllers at http://localhost:5173/api/docs,
in development only and through the Vite proxy: Better Auth trusts only
`APP_URL`, so "Try it out" from `localhost:3000` fails with
`INVALID_ORIGIN`. Better Auth's own schema endpoint and Scalar page are off
everywhere ([`openapi/openapi.ts`](../../../apps/api/src/openapi/openapi.ts)).

**Body parsing.** Better Auth reads the raw request, so Nest's body parser is
off and the auth module adds JSON and urlencoded parsing back for other
routes. Its `bodyParser: { rawBody: true }` keeps `req.rawBody` for the
Messenger webhook's signature check; `rawBody: true` on `NestFactory` has no
effect.

## Errors

Better Auth writes errors straight to the response, bypassing
`AllExceptionsFilter`. An after-hook in `auth.config.ts` runs each through
[`toAuthErrorBody`](../../../apps/api/src/modules/auth/auth-errors.ts), so
auth errors parse like any other. Redirects (302) pass untouched.

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
| anything else                           | `HTTP_<status>`, the global filter's fallback                                                                                |

## Data

Better Auth owns seven tables: `user`, `session`, `account` and
`verification` from its core, and `organization`, `member` and `invitation`
from the Organization plugin. `user` has two `additionalFields` of ours:
`phone` (E.164, null for a social sign-up) and `locale` (the dashboard
language, set only by `PATCH /api/v1/account/preferences`). `user.image` is
the profile photo and `organization.logo` the shop logo.

`pnpm --filter api db:auth-schema` regenerates
[`database/schema/auth.ts`](../../../apps/api/src/modules/database/schema/auth.ts);
then `db:generate`, review the SQL, `db:migrate`. The CLI entry,
[`auth.cli.ts`](../../../apps/api/src/modules/auth/auth.cli.ts), builds the
config against `drizzle.mock()`, so it needs no database or credentials.

The `app_runtime` role is granted these tables
([Database](../../architecture/database.md#roles)), but they must never get an
RLS policy: they have no `merchant_id`, and the session lookup runs before any
merchant context exists, so a policy would block sign-in.

## Configuration

Read by [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts)
from `environments/.env`.

| Variable                                       | Required | Notes                                                                     |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `APP_URL`                                      | yes      | The SPA origin. Better Auth's `baseURL` and its only trusted origin       |
| `BETTER_AUTH_SECRET`                           | yes      | At least 32 characters. Signs sessions and tokens                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | no       | Google sign-in                                                            |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | no       | Facebook sign-in                                                          |
| `SMTP_URL`, `MAIL_FROM`                        | yes      | Verification and reset email. Locally, Mailpit at `smtp://localhost:1025` |

## Security notes

- **No account enumeration.** A sign-up with a taken email and a reset for an
  unknown one both look like success.
- **A reset ends every session.**
- **Nothing sensitive in logs.** Better Auth logs to pino at `warn`, because
  at `info` it logs the address behind a duplicate sign-up. A failed send logs
  only the subject and the recipient's domain, since the body holds a
  single-use token.
- **The client never picks the tenant.** The server sets
  `activeOrganizationId`; `TenantGuard`, every repository and RLS check it.

## Tests

| Spec                                                                                                                             | Covers                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`auth/__tests__/email-password.e2e.spec.ts`](../../../apps/api/src/modules/auth/__tests__/email-password.e2e.spec.ts)           | Every email and password flow above over real HTTP, organization resolution, mount point, raw-body preservation |
| [`auth/__tests__/auth-errors.spec.ts`](../../../apps/api/src/modules/auth/__tests__/auth-errors.spec.ts)                         | The error mapping table                                                                                         |
| [`database/__tests__/ensure-organization.spec.ts`](../../../apps/api/src/modules/database/__tests__/ensure-organization.spec.ts) | Organization bootstrap and its idempotency                                                                      |

The e2e and organization specs need Postgres and are skipped unless
`TEST_DATABASE_ADMIN_URL` is set (see `AGENTS.md`). Run them with
`pnpm --filter api test -- auth`.

## Not yet built

- **Email verified screen.** A good link lands on `/` with no confirmation; a
  bad one (`/?error=…`) lands on sign-in with an error banner.
- **Terms and privacy pages.** Sign-up requires agreeing, and
  `apps/web/src/features/auth/legal.ts` links `/terms` and `/privacy`. Caddy
  serves them from `static/` as `/legal/*.html`, but each page is only a
  placeholder, and the server does not record the agreement.
- **Shop name and phone for social sign-ups.** The shop is named after the
  seller and uses the default region, Bangladesh, until its first save in
  Settings – General.
- **Organization switcher.** Deferred; the data model already allows several
  organizations per seller.

## Key files

- [`auth/auth.config.ts`](../../../apps/api/src/modules/auth/auth.config.ts): the Better Auth configuration
- [`auth/auth.module.ts`](../../../apps/api/src/modules/auth/auth.module.ts): mounting and body parser
- [`auth/session.guard.ts`](../../../apps/api/src/modules/auth/session.guard.ts): the global session requirement
- [`auth/auth-errors.ts`](../../../apps/api/src/modules/auth/auth-errors.ts): error mapping
- [`common/tenant.guard.ts`](../../../apps/api/src/common/tenant.guard.ts): merchant resolution
- [`database/ensure-organization.ts`](../../../apps/api/src/modules/database/ensure-organization.ts): organization bootstrap
- [`mail/templates.ts`](../../../apps/api/src/modules/mail/templates.ts) and [`mail/layout.ts`](../../../apps/api/src/modules/mail/layout.ts): auth emails
- [`packages/shared/src/schemas/auth.ts`](../../../packages/shared/src/schemas/auth.ts): password and sign-up rules
