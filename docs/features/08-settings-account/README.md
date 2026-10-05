# 08 · Settings – Account

The signed-in person's own settings: their name and profile photo, the ways
they can sign in, their password, and the devices signed in to the account.
Everything here belongs to the person, not the shop, so no route on this page
carries `TenantGuard`. The shop's own settings are
[06 · Settings – General](../06-settings-general/README.md). Sign-up, sign-in
and the auth plumbing are [01 · Authentication](../01-auth/README.md). This page
describes what is built.

**Status (Oct 2026):** built end to end, in the API and at `/settings/account`
in the dashboard.

## Routes

Our own routes, in
[`account.controller.ts`](../../../apps/api/src/modules/account/account.controller.ts)
under `/api/v1/account`, need a session only:

| Route                  | Request                                                       | Response                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /preferences`   | `{ locale }`, one of `DASHBOARD_LOCALES` or `null`            | `{ locale }`; the session's `user.locale` carries it afterwards                                                                          |
| `PUT /avatar`          | multipart, one `file`: JPEG, PNG or WebP, ≤ 5 MB, ≥ 256 × 256 | `{ image }`; 400 `AVATAR_INVALID` / `AVATAR_TOO_SMALL`, 413 `AVATAR_TOO_LARGE`, 415 `AVATAR_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| `DELETE /avatar`       | —                                                             | `{ image: null }`                                                                                                                        |
| `GET /sessions`        | —                                                             | `DeviceSession[]`: unexpired sessions, the current one first                                                                             |
| `DELETE /sessions/:id` | —                                                             | 204; 404 `SESSION_NOT_FOUND`, 409 `SESSION_IS_CURRENT`                                                                                   |

Better Auth's own endpoints, under `/api/v1/auth`, cover the rest:

| Endpoint                | Used for                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /update-user`     | The person's name. `locale` is refused here; only `PATCH /account/preferences` sets it                          |
| `POST /change-password` | Changing the password, optionally ending every other session (`revokeOtherSessions`, on by default in the form) |
| `GET /list-accounts`    | The linked sign-in methods                                                                                      |
| `POST /link-social`     | Linking Google or Facebook; the provider redirects back to `/settings/account`                                  |
| `POST /unlink-account`  | Removing a Google or Facebook sign-in, by the account row's id                                                  |

Shapes are in
[`packages/shared/src/schemas/account.ts`](../../../packages/shared/src/schemas/account.ts):
`DeviceSession` is `{ id, browser | null, os | null, createdAt, lastActiveAt, current }`,
never a token or an IP address.

## Rules

- **Profile photo.** Normalized like a product photo: decoded and re-encoded
  by `sharp`, metadata stripped, stored as a 512 px square JPEG at
  `u/<userId>/avatar/<uuid>.jpg`, outside the product sweep's `m/` prefix. Its
  public URL is `user.image`. Uploads have their own throttle of 30 a minute.
  The shop logo in Settings – General reuses this pipeline.
- <a id="sign-in-methods"></a>**Sign-in methods.** This page is the only place
  a Facebook identity joins an existing account, since Facebook doesn't
  guarantee a verified email ([Account linking](../01-auth/README.md#account-linking)).
  A refused link comes back as `?error=<ErrorCode>`: `AUTH_SOCIAL_EMAIL_MISMATCH`
  (the provider's email isn't the person's), `AUTH_SOCIAL_ACCOUNT_TAKEN`
  (another seller signs in with it), `AUTH_SOCIAL_CANCELLED` or
  `AUTH_SOCIAL_FAILED`. Unlinking refuses the last method
  (`AUTH_LAST_SIGN_IN_METHOD`) and needs a session under a day old
  (`AUTH_SESSION_NOT_FRESH`).
- **Password.** Changing it needs the current one (`AUTH_WRONG_PASSWORD`). A
  seller who signed up with Google or Facebook has none; they add one through
  the emailed reset link, which proves they control the mailbox, and Better
  Auth creates the password sign-in and signs every session out.
- **Devices.** Signing a device out isn't confirmed: it is undone by signing in
  again. The current session can't be signed out here (`SESSION_IS_CURRENT`);
  that is Sign out. Sessions end through Better Auth's internal adapter, not a
  table delete, so a cookie cache added later is cleared too.
- **Dashboard language** is per person, on `user.locale`. Unset, the dashboard
  uses the shop country's (`defaultDashboardLocale(country)`).
  `DASHBOARD_LOCALES` is `['en']` until another translation exists.

## Dashboard

`/settings/account` shows four cards, each loading and failing on its own:
Profile (name and photo), Sign-in methods, Password, and Devices. The language
picker sits on Settings – General's Region card. Code:
`apps/web/src/features/account/` and, for the sign-in methods card,
`apps/web/src/features/auth/`.

## Tests

| Spec                                                                                                           | Covers                                                   |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`account/__tests__/account.e2e.spec.ts`](../../../apps/api/src/modules/account/__tests__/account.e2e.spec.ts) | The account routes over HTTP                             |
| [`account/avatar/__tests__/`](../../../apps/api/src/modules/account/avatar/__tests__/)                         | Normalization, keys, the `user.image` write, the service |
| [`account/sessions/__tests__/`](../../../apps/api/src/modules/account/sessions/__tests__/)                     | Listing and revoking sessions, user-agent descriptions   |

## Follow-ups

- **Changing the email address** and **deleting the account** have no route
  yet. Account deletion also owes the bulk object removal noted in
  [Catalog](../02-catalog/README.md#not-yet-built).
