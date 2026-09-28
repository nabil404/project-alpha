# Google sign-in setup

How to create the Google OAuth client behind "Continue with Google", and fill:

```dotenv
# ---- Auth ----
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Both are optional. Without them the API still boots and email/password sign-in
keeps working; only the Google button fails. See
[`env.schema.ts`](../../apps/api/src/config/env.schema.ts).

Google renames Cloud Console menus often. If a label below has moved, search
the console for the page name (for example "OAuth consent screen" or
"Clients").

## What the app expects

Better Auth is mounted on the SPA's origin (`APP_URL`) under `/api/v1/auth`
([`auth.config.ts`](../../apps/api/src/auth/auth.config.ts)), so Google must
redirect to:

| Environment | Authorized JavaScript origin | Authorized redirect URI                             |
| ----------- | ---------------------------- | --------------------------------------------------- |
| Local dev   | `http://localhost:5173`      | `http://localhost:5173/api/v1/auth/callback/google` |
| Production  | `https://<your-domain>`      | `https://<your-domain>/api/v1/auth/callback/google` |

Use the Vite origin (`:5173`), never the API's own port `:3000`. Vite proxies
`/api` to the API in development, and Caddy does the same in production. Better
Auth trusts only `APP_URL`, so a flow started from `:3000` fails with
`INVALID_ORIGIN`.

The app requests Google's default scopes only: `openid`, `email` and
`profile`. Because Google guarantees a verified email, a Google sign-in links
automatically to an existing account with the same address.

## Steps

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account
   that should own the app (ideally a shared team account, not a personal one).
2. In the project picker at the top, choose **New project**.
3. Name it, for example `messenger-to-order-dev`. Create a separate project
   for production later (see [Environments](#environments)).
4. Make sure the new project is selected in the picker before continuing.

No API needs to be enabled for sign-in: basic OpenID Connect works without
enabling any Google API.

### 2. Configure the OAuth consent screen

Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth
Platform** in newer consoles) and click **Get started**.

1. **App information**
   - App name: the name sellers will see, for example `Messenger to Order`.
   - User support email: a team inbox.
2. **Audience:** choose **External**. (Internal is only for Google Workspace
   users inside your own organization.)
3. **Contact information:** a developer email Google can reach.
4. Accept the policy and click **Create**.

Then finish the remaining tabs:

- **Branding**
  - App logo (optional; adding one triggers brand verification).
  - App home page: `https://<your-domain>`.
  - Privacy policy: `https://<your-domain>/privacy`.
  - Terms of service: `https://<your-domain>/terms`.
  - Authorized domains: `<your-domain>` (the bare domain, no scheme).
    `localhost` needs no entry.
- **Data access → Add or remove scopes:** select
  - `openid`
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`

  These are non-sensitive scopes, so no security assessment is required.

- **Audience → Test users:** while the app is in **Testing**, only the
  addresses listed here can sign in. Add every developer and tester.

### 3. Create the OAuth client

1. Go to **APIs & Services → Credentials** (or **Google Auth Platform →
   Clients**) and choose **Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: for example `api-local`.
4. **Authorized JavaScript origins:** `http://localhost:5173`.
5. **Authorized redirect URIs:**
   `http://localhost:5173/api/v1/auth/callback/google`.
6. Click **Create**.

The dialog shows the **Client ID** and **Client secret**. Download the JSON or
copy them now. Newer consoles show the secret only once; if you lose it, add a
new secret on the client's page and delete the old one.

Changes to origins and redirect URIs can take a few minutes to apply.

### 4. Fill the env file

In `apps/api/.env`:

```dotenv
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Restart the API (`pnpm dev`). The values are read once at boot.

Never commit `apps/api/.env`, and never paste the secret into logs, issues or
chat.

### 5. Verify

1. `pnpm dev:up` then `pnpm dev`.
2. Open <http://localhost:5173/sign-in> and click the Google button.
3. Pick a test-user account and accept the consent screen.
4. You should land in the dashboard, signed in. A first sign-in also creates the
   seller's organization.

## Troubleshooting

| Symptom                                         | Cause and fix                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error 400: redirect_uri_mismatch`              | The redirect URI registered on the client does not exactly match `${APP_URL}/api/v1/auth/callback/google`. Check scheme, port and trailing slash. |
| `Error 403: access_denied` / "app not verified" | The app is in Testing and your account is not a test user. Add it under **Audience → Test users**.                                                |
| `INVALID_ORIGIN` from the API                   | The flow was started from `localhost:3000`. Use `localhost:5173`.                                                                                 |
| `invalid_client`                                | Wrong or stale client ID/secret, or a stray space in `.env`. Copy again and restart the API.                                                      |
| `Missing required parameter: client_id`         | `GOOGLE_CLIENT_ID` is empty, or the API was not restarted after editing `.env`.                                                                   |

## Environments

Use one OAuth client per environment, each registering only its own origin and
redirect URI, so a leaked development secret cannot sign anyone into
production.

| Environment | Project                   | Client      | Origin / redirect base  |
| ----------- | ------------------------- | ----------- | ----------------------- |
| Local dev   | `messenger-to-order-dev`  | `api-local` | `http://localhost:5173` |
| Production  | `messenger-to-order-prod` | `api-prod`  | `https://<your-domain>` |

### Going to production

1. Create the production client with the production origin and redirect URI.
2. Put its values into the production environment's secrets, not into any
   committed file.
3. On the consent screen, click **Publish app** to move from Testing to **In
   production**. Without this, only test users can sign in, and refresh tokens
   expire after seven days.
4. If you set a logo or custom branding, Google runs brand verification
   (usually a few business days). The privacy policy and terms pages must be
   live on the authorized domain first; Caddy serves them at `/privacy` and
   `/terms`.
