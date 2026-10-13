# 08 · Settings – Account

The signed-in person's own settings: name and profile photo, sign-in methods,
password, and signed-in devices. These belong to the person, not the shop, so
no route here carries `TenantGuard`. The shop's settings are
[06 · Settings – General](../06-settings-general/README.md); sign-up and
sign-in are [01 · Authentication](../01-auth/README.md).

**Status (Oct 2026):** built in the API and at `/settings/account`.

## Routes

Our routes, in
[`account.controller.ts`](../../../apps/api/src/modules/account/account.controller.ts)
under `/api/v1/account`, need a session only:

| Route                  | Request                                                       | Response                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /preferences`   | `{ locale }`, one of `DASHBOARD_LOCALES` or `null`            | `{ locale }`, carried on the session's `user.locale` afterwards                                                                          |
| `PUT /avatar`          | multipart, one `file`: JPEG, PNG or WebP, ≤ 5 MB, ≥ 256 × 256 | `{ image }`; 400 `AVATAR_INVALID` / `AVATAR_TOO_SMALL`, 413 `AVATAR_TOO_LARGE`, 415 `AVATAR_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| `DELETE /avatar`       | none                                                          | `{ image: null }`                                                                                                                        |
| `GET /sessions`        | none                                                          | `DeviceSession[]`: unexpired sessions, the current one first                                                                             |
| `DELETE /sessions/:id` | none                                                          | 204; 404 `SESSION_NOT_FOUND`, 409 `SESSION_IS_CURRENT`                                                                                   |

Better Auth's endpoints under `/api/v1/auth` cover the rest:

| Endpoint                | Used for                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `POST /update-user`     | The name. It refuses `locale`                                                               |
| `POST /change-password` | Changing the password. `revokeOtherSessions` ends every other session and is on in the form |
| `GET /list-accounts`    | The linked sign-in methods                                                                  |
| `POST /link-social`     | Linking Google or Facebook; the provider redirects back to `/settings/account`              |
| `POST /unlink-account`  | Removing a Google or Facebook sign-in by the account row's id                               |

`DeviceSession` is `{ id, browser | null, os | null, createdAt, lastActiveAt, current }`,
in [`packages/shared/src/schemas/account.ts`](../../../packages/shared/src/schemas/account.ts).
It never carries a token or an IP address.

## Rules

- **Profile photo.** `sharp` decodes and re-encodes it as a 512 px square
  JPEG without metadata, stored at `u/<userId>/avatar/<uuid>.jpg`, outside the
  product sweep's `m/` prefix. The public URL is saved on `user.image`.
  Uploads have their own throttle of 30 a minute. The shop logo
  ([General](../06-settings-general/README.md#rules)) reuses this code.
- <a id="sign-in-methods"></a>**Sign-in methods.** This page is the only place
  a Facebook identity joins an existing account, because Facebook does not
  guarantee a verified email
  ([Account linking](../01-auth/README.md#account-linking)). A refused link
  comes back as `?error=<ErrorCode>`:
  - `AUTH_SOCIAL_EMAIL_MISMATCH`: the provider's email is not the person's.
  - `AUTH_SOCIAL_ACCOUNT_TAKEN`: another seller signs in with it.
  - `AUTH_SOCIAL_CANCELLED` or `AUTH_SOCIAL_FAILED`.

  Unlinking refuses the last method (`AUTH_LAST_SIGN_IN_METHOD`) and needs a
  session under a day old (`AUTH_SESSION_NOT_FRESH`).

- **Password.** Changing it needs the current one (`AUTH_WRONG_PASSWORD`). A
  seller who signed up with Google or Facebook has none. They add one through
  the emailed reset link, which proves they control the mailbox. Better Auth
  then creates the password sign-in and signs every session out.
- **Devices.** Signing a device out asks for no confirmation, since signing
  in again undoes it. The current session is refused (`SESSION_IS_CURRENT`);
  Sign out handles it. `BetterAuthSessionRevoker` ends sessions through Better
  Auth's internal adapter rather than a table delete, so a cookie cache added
  later is cleared too.
- **Dashboard language** is per person, on `user.locale`. Unset, the dashboard
  uses `defaultDashboardLocale(country)` for the shop's country.
  `DASHBOARD_LOCALES` is `['en']` until another translation exists.

## Dashboard

`/settings/account` has four cards that load and fail independently: Profile
(name and photo), Sign-in methods, Password, and Devices. The language picker
is on Settings – General's Region card. Code: `apps/web/src/features/account/`,
and `SignInMethodsCard` in `apps/web/src/features/auth/`.

## Tests

| Spec                                                                                                           | Covers                                                   |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`account/__tests__/account.e2e.spec.ts`](../../../apps/api/src/modules/account/__tests__/account.e2e.spec.ts) | The account routes over HTTP                             |
| [`account/avatar/__tests__/`](../../../apps/api/src/modules/account/avatar/__tests__/)                         | Normalization, keys, the `user.image` write, the service |
| [`account/sessions/__tests__/`](../../../apps/api/src/modules/account/sessions/__tests__/)                     | Listing and revoking sessions, user-agent descriptions   |

## Follow-ups

- No route changes the email address or deletes the account yet. Account
  deletion also needs the bulk object removal noted in
  [Catalog](../02-catalog/README.md#not-yet-built).
