# Meta (Facebook) setup

How to create the two Meta apps behind "Continue with Facebook", the Page
connection and the Messenger webhook, and fill:

```dotenv
# ---- Auth ----
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=

# ---- Meta ----
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_GRAPH_VERSION=v21.0
```

`FACEBOOK_*` and `META_APP_ID` are optional: without `FACEBOOK_*` only the
Facebook sign-in button fails, and without `META_APP_ID` connecting a Page
answers `MESSENGER_NOT_CONFIGURED`. `META_APP_SECRET`, `META_VERIFY_TOKEN` and
`META_GRAPH_VERSION` are **required**; the API refuses to boot without them
([`env.schema.ts`](../../apps/api/src/config/env.schema.ts)).

Meta renames App Dashboard menus often. If a label below has moved, look for
the product name ("Facebook Login", "Facebook Login for Business",
"Messenger", "Webhooks") in the left sidebar or the app's **Use cases** page.

## Two apps, not one

Meta does not let the consumer **Facebook Login** use case share an app with
the **Messenger** use case ("Some use cases can't be combined on the same
app"). So there are two apps per environment:

| App                                              | Use case                                                       | Used for                                             |
| ------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------- |
| **Sign-in app**, e.g. `Messenger to Order Login` | _Authenticate and request data from users with Facebook Login_ | "Continue with Facebook" (`public_profile`, `email`) |
| **Messenger app**, e.g. `Messenger to Order`     | _Engage with customers on Messenger from Meta_                 | Page connection and the Messenger webhook            |

The Page connection **must** go through the Messenger app. Page access tokens
and webhook subscriptions belong to the app that obtained them, and the webhook
verifies signatures with that app's secret, so a Page connected through the
sign-in app would deliver its messages to the wrong app.

| Variable                 | Value                           | Read by                                                                                                                |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `FACEBOOK_CLIENT_ID`     | **Sign-in app** App ID          | Better Auth ([`auth.config.ts`](../../apps/api/src/auth/auth.config.ts))                                               |
| `FACEBOOK_CLIENT_SECRET` | **Sign-in app** App Secret      | Better Auth                                                                                                            |
| `META_APP_ID`            | **Messenger app** App ID        | Page connection ([`facebook-page.module.ts`](../../apps/api/src/modules/messenger/page/facebook-page.module.ts))       |
| `META_APP_SECRET`        | **Messenger app** App Secret    | Page connection, and the webhook signature check ([`signature.ts`](../../apps/api/src/modules/messenger/signature.ts)) |
| `META_VERIFY_TOKEN`      | A random string you invent      | Webhook handshake ([`messenger.controller.ts`](../../apps/api/src/modules/messenger/messenger.controller.ts))          |
| `META_GRAPH_VERSION`     | Graph API version, e.g. `v21.0` | Graph API calls                                                                                                        |

The same Facebook user gets a different, app-scoped ID in each app. Nothing
relies on them matching: a connected Page belongs to the seller's shop, not to
their Facebook sign-in identity.

## What the apps expect

| App       | Purpose                      | URL (local dev)                                   | URL (production)                                             |
| --------- | ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Sign-in   | Facebook Login redirect URI  | none: localhost is allowed in Development mode    | `https://<your-domain>/api/v1/auth/callback/facebook`        |
| Messenger | Page connection redirect URI | none: localhost is allowed in Development mode    | `https://<your-domain>/api/v1/messenger/page/oauth/callback` |
| Messenger | Messenger webhook callback   | `https://<tunnel-host>/api/v1/webhooks/messenger` | `https://<your-domain>/api/v1/webhooks/messenger`            |
| Both      | Privacy policy               | —                                                 | `https://<your-domain>/privacy`                              |
| Both      | Terms of service             | —                                                 | `https://<your-domain>/terms`                                |
| Both      | Data deletion instructions   | —                                                 | `https://<your-domain>/data-deletion`                        |

- Better Auth is mounted on the SPA's origin (`APP_URL`) under `/api/v1/auth`.
  Use the Vite origin `:5173` locally, never the API's `:3000`, or Better Auth
  rejects the flow with `INVALID_ORIGIN`.
- Facebook sign-in asks for `public_profile` and `email` only. Page
  permissions (`pages_show_list`, `pages_messaging`, `pages_manage_metadata`)
  are requested by the Messenger app in the separate Page connection step,
  never at sign-in ([auth feature doc](../features/01-auth/README.md),
  [Page connection feature doc](../features/03-facebook-page/README.md)).
- Facebook identities never link automatically to an existing account by
  email, because Facebook does not guarantee a verified address.
- The webhook needs a public HTTPS URL, even in development (see
  [step 8](#8-subscribe-the-messenger-webhook)).
- Caddy serves the privacy, terms and data-deletion pages
  ([`docker/Caddyfile`](../../docker/Caddyfile)); Meta requires them on both
  apps before App Review.

## Steps

### 1. Prerequisites

- A personal Facebook account with two-factor authentication on.
- A **Meta developer account**: open <https://developers.facebook.com/>,
  click **Get Started**, and verify your phone and email.
- A **test Facebook Page** you administer, for receiving Messenger messages.
- A **Business portfolio** (formerly Business Manager) at
  <https://business.facebook.com/> is **not** needed for development: both
  apps work in Development mode for everyone with a role on them
  ([step 9](#9-roles-and-testers)). It is needed to go live, because Business
  Verification and advanced access to Page permissions are granted to the
  portfolio. Verification can take weeks, so the MVP plan still starts it in
  week 1 ([meta requirements](../mvp/01-messenger-to-order/meta-requirements.md)).

### 2. Create the sign-in app

1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. App name: for example `Messenger to Order Login (dev)`. Contact email: a
   team inbox.
3. **Use cases:** select **Authenticate and request data from users with
   Facebook Login** only.
4. **Business:** skip it ("I don't want to connect a business portfolio yet")
   or connect the portfolio if you already have one. It can be connected later
   from **App settings → Basic**.
5. Finish the wizard. The app starts in **Development** mode: only people with
   a role on it can use it.

Then on **App settings → Basic**:

- **App ID** → `FACEBOOK_CLIENT_ID`.
- **App secret** → click **Show**, re-enter your password, copy it into
  `FACEBOOK_CLIENT_SECRET`.

### 3. Configure Facebook Login (sign-in app)

Open **Use cases → Authenticate and request data from users with Facebook
Login → Customize** (older dashboards: **Facebook Login → Settings**).

1. **Permissions:** make sure `public_profile` and `email` are added. `email`
   may need **Add** clicked explicitly.
2. **Settings:**
   - **Client OAuth login:** Yes.
   - **Web OAuth login:** Yes.
   - **Enforce HTTPS:** Yes. It can't be turned off.
   - **Use Strict Mode for redirect URIs:** Yes.
   - **Valid OAuth Redirect URIs:** leave it **empty** on the dev app. The
     field refuses any `http://` URI, `http://localhost:5173/…` included, but
     Meta accepts `http://localhost` redirects without an entry while the app
     is in **Development** mode. The production app lists
     `https://<your-domain>/api/v1/auth/callback/facebook`.
3. **Save changes.**

If Facebook still answers "URL blocked" locally, see
[HTTPS through a tunnel](#https-through-a-tunnel).

### 4. Create the Messenger app

1. Back at <https://developers.facebook.com/apps> → **Create app**.
2. App name: for example `Messenger to Order (dev)`.
3. **Use cases:** select **Engage with customers on Messenger from Meta**. If
   the dashboard asks for an app type instead, choose **Business**.
4. **Business:** skip or connect, as in step 2.
5. Finish the wizard.

Then on **App settings → Basic**:

- **App ID** → `META_APP_ID`.
- **App secret** → **Show**, copy it into `META_APP_SECRET`.

### 5. Configure the Page connection (Messenger app)

The seller connects their Page through a Facebook dialog run by this app, so
it needs its own redirect URI and the Page permissions.

1. Open **Use cases → Engage with customers on Messenger from Meta →
   Customize → Permissions** and make sure `pages_show_list`,
   `pages_messaging` and `pages_manage_metadata` are added.
2. Open the app's login settings (**Facebook Login for Business → Settings**
   in the sidebar; older dashboards: **Facebook Login → Settings**) and set
   - **Client OAuth login** and **Web OAuth login:** Yes,
   - **Use Strict Mode for redirect URIs:** Yes,
   - **Valid OAuth Redirect URIs:** empty on the dev app, for the same reason
     as in [step 3](#3-configure-facebook-login-sign-in-app); the production
     app lists `https://<your-domain>/api/v1/messenger/page/oauth/callback`.
3. **Save changes.**

### 6. Generate `META_VERIFY_TOKEN`

The verify token is a shared secret **you** invent. Meta sends it back once,
when you subscribe the webhook, and the API compares it to
`META_VERIFY_TOKEN`.

```bash
openssl rand -hex 32
```

Put the output in `apps/api/.env` **before** subscribing the webhook, and
restart the API.

### 7. Choose `META_GRAPH_VERSION`

The default `v21.0` is fine to start. To pin the version the Messenger app was
created on, read it from **App settings → Advanced → Upgrade API version** (or
the version picker in the Graph API Explorer).

- The format must be `vNN.N`; anything else fails env validation at boot.
- Meta retires each version about two years after release. Check the
  [changelog](https://developers.facebook.com/docs/graph-api/changelog) and
  bump this value before the version you use is deprecated.

### 8. Subscribe the Messenger webhook

All of this is on the **Messenger app**. Meta calls the webhook from the
internet over HTTPS, so locally you need a tunnel to your machine.

1. Start the stack: `pnpm dev:up`, `pnpm dev` and
   `pnpm --filter api dev:worker`.
2. Start a tunnel to the Vite dev server (which proxies `/api` to the API),
   for example:

   ```bash
   cloudflared tunnel --url http://localhost:5173
   # or
   ngrok http 5173
   ```

   Note the `https://…` host it prints. Free tunnels change host on each
   restart; resubscribe when that happens.

   `vite.config.ts` allows `*.trycloudflare.com` and `*.ngrok-free.app`
   hosts; for any other tunnel, add its domain to `server.allowedHosts` or
   point the tunnel at the API directly (`http://localhost:3000`).

3. In the dashboard, open **Use cases → Engage with customers on Messenger
   from Meta → Customize → Messenger API Settings** (older dashboards:
   **Messenger → Settings**).
4. Under **Configure webhooks**:
   - **Callback URL:** `https://<tunnel-host>/api/v1/webhooks/messenger`
   - **Verify token:** the value of `META_VERIFY_TOKEN`
   - Click **Verify and save**. Meta sends
     `GET …?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and expects
     the challenge echoed back.
5. **Webhook fields:** subscribe to at least
   - `messages` (customer messages),
   - `messaging_postbacks`,
   - `message_echoes` (the seller's own replies, which pause the bot).

   The API currently acts on text `messages` and text `message_echoes` (stored
   as seller messages; echoes of replies sent by this app are skipped). Other
   fields, and messages without text, are acknowledged and ignored.

6. Connect your test Page, either way:
   - **In the app (preferred):** sign in, open **Settings → Messenger** and
     click **Connect**. This runs the Page connection through `META_APP_ID`
     and subscribes the Page to the app's webhooks.
   - **From the dashboard:** under **Generate access tokens**, click **Add or
     connect Pages**, pick your test Page and grant the requested permissions.

If you generate a Page access token in the dashboard for manual testing, treat
it as a secret: never commit it, paste it in an issue, or log it.

### 9. Roles and testers

While an app is in Development mode, only people with a role on it can use it.
Add each developer and tester to **both** apps: the sign-in app for "Continue
with Facebook", the Messenger app for connecting a Page and for having their
messages delivered to the webhook.

In each app, open **App roles → Roles** and add them as **Administrator**,
**Developer** or **Tester**. They must accept the invitations at
<https://developers.facebook.com/requests>.

### 10. Fill the env file

In `apps/api/.env`:

```dotenv
# ---- Auth ----
# Sign-in app
FACEBOOK_CLIENT_ID=123456789012345
FACEBOOK_CLIENT_SECRET=0123456789abcdef0123456789abcdef

# ---- Meta ----
# Messenger app
META_APP_ID=543210987654321
META_APP_SECRET=fedcba9876543210fedcba9876543210
META_VERIFY_TOKEN=<output of openssl rand -hex 32>
META_GRAPH_VERSION=v21.0
```

A `$` in any value must be written `$$`: compose interpolates this file.
Restart the API and the worker after any change.

### 11. Verify

1. **Sign-in:** open <http://localhost:5173/sign-in>, click the Facebook
   button, and sign in with an account that has a role on the sign-in app. You
   should land in the dashboard.
2. **Handshake:** **Verify and save** in step 8 succeeded.
3. **Page connection:** **Settings → Messenger → Connect** shows your test
   Page and ends in the connected state.
4. **Delivery:** from a personal account with a role on the Messenger app,
   send a text message to the test Page. The API answers `EVENT_RECEIVED` and
   the worker log shows the `inbound-message` job. The dashboard's **Test**
   button next to a webhook field sends a sample payload too.

## HTTPS through a tunnel

The fallback when Facebook won't redirect to `http://localhost`, for example
because the app has left Development mode. It puts the whole dashboard behind
one HTTPS host, so the redirect URI can be a real `https://` entry.

1. Start a tunnel to the Vite dev server:
   `cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`).
   `vite.config.ts` already allows `*.trycloudflare.com` and
   `*.ngrok-free.app` hosts.
2. In `apps/api/.env`, set `APP_URL=https://<tunnel-host>` and restart the API.
   Better Auth trusts only `APP_URL`, and the Page connection derives its
   redirect URI from it.
3. Add `https://<tunnel-host>/api/v1/auth/callback/facebook` to the sign-in
   app, and `https://<tunnel-host>/api/v1/messenger/page/oauth/callback` to the
   Messenger app.
4. Open the dashboard at `https://<tunnel-host>`, not `localhost`: the session
   cookie is set on the host you sign in on.

Free tunnel hosts change on every restart, so steps 2 and 3 repeat each time.
A named Cloudflare tunnel keeps one host.

## Troubleshooting

| Symptom                                                                         | Cause and fix                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Some use cases can't be combined on the same app"                              | Facebook Login and Messenger were selected on one app. Create two apps ([Two apps, not one](#two-apps-not-one)).                                                                                                                                                                                                                                                |
| Valid OAuth Redirect URIs refuses `http://localhost:5173/…`                     | Expected: Enforce HTTPS rejects every `http://` entry. Leave the field empty; localhost works while the app is in Development mode.                                                                                                                                                                                                                             |
| "URL blocked: This redirect failed because the redirect URI is not whitelisted" | Locally: the app is no longer in Development mode, or `APP_URL` isn't `localhost`; use [a tunnel](#https-through-a-tunnel). Otherwise, on sign-in: the sign-in app lacks `${APP_URL}/api/v1/auth/callback/facebook`. On Page connection: the Messenger app lacks `${APP_URL}/api/v1/messenger/page/oauth/callback`. With Strict Mode on, it must match exactly. |
| "App not active" / "Feature unavailable"                                        | The app is in Development mode and your account has no role on **that** app. Add it in [step 9](#9-roles-and-testers).                                                                                                                                                                                                                                          |
| `INVALID_ORIGIN` from the API                                                   | The flow was started from `localhost:3000`. Use `localhost:5173`.                                                                                                                                                                                                                                                                                               |
| Sign-in succeeds but no email arrives on the user                               | The Facebook account has no confirmed email, or `email` was not granted. Check the permission in [step 3](#3-configure-facebook-login-sign-in-app).                                                                                                                                                                                                             |
| Connecting a Page answers `MESSENGER_NOT_CONFIGURED`                            | `META_APP_ID` is unset. Fill it with the Messenger app's App ID and restart the API.                                                                                                                                                                                                                                                                            |
| The Page connection dialog rejects the permissions ("Invalid Scopes")           | The Messenger app does not have `pages_show_list`, `pages_messaging` and `pages_manage_metadata` added ([step 5](#5-configure-the-page-connection-messenger-app)), or `META_APP_ID` is the sign-in app's ID.                                                                                                                                                    |
| "The callback URL or verify token couldn't be validated"                        | Tunnel down or wrong host, or the API answered 401 `WEBHOOK_VERIFICATION_FAILED` because the token differs from `META_VERIFY_TOKEN`. Restart the API after editing `.env`.                                                                                                                                                                                      |
| Every webhook POST answers 401 `WEBHOOK_INVALID_SIGNATURE`                      | `META_APP_SECRET` is not the Messenger app's App Secret (the sign-in app's, another environment's, or reset since). Copy it again from the Messenger app's **App settings → Basic**.                                                                                                                                                                            |
| Handshake works but no messages arrive                                          | The Page is not connected ([step 8.6](#8-subscribe-the-messenger-webhook)), `messages` is not subscribed, or the sender has no role on the Messenger app while it is in Development mode.                                                                                                                                                                       |
| API refuses to boot: `META_GRAPH_VERSION`                                       | The value is not in `vNN.N` form.                                                                                                                                                                                                                                                                                                                               |

## Secrets

If an App Secret ever leaks, use **Reset** on that app's **App settings →
Basic**, then update the variable that holds it (`FACEBOOK_CLIENT_SECRET` for
the sign-in app, `META_APP_SECRET` for the Messenger app) everywhere and
restart the API and worker.

## Environments

Create a separate pair of apps per environment (for example
`Messenger to Order Login (dev)` + `Messenger to Order (dev)`, and
`Messenger to Order Login` + `Messenger to Order`), each with its own redirect
URIs, webhook URL, App Secrets and verify token. A leaked development secret
then cannot forge production webhooks.

## Going live

Before real sellers can sign in with Facebook, connect Pages and receive
customer messages:

1. **Business portfolio and Business Verification** (**Business settings →
   Security Center**), then connect both apps to the portfolio from **App
   settings → Basic**. Verification can take days to weeks; start it in week 1.
2. On **App settings → Basic** of **both** apps, fill in:
   - **App domains:** `<your-domain>`.
   - **Privacy policy URL:** `https://<your-domain>/privacy`.
   - **Terms of service URL:** `https://<your-domain>/terms`.
   - **User data deletion:** **Data deletion instructions URL**,
     `https://<your-domain>/data-deletion`.
   - **App icon** (1024×1024) and **Category** (for example "Business and
     pages").

   Make sure those pages are live on the production domain.

3. **App Review** of the **Messenger app** (**App Review → Requests**) for
   advanced access to the permissions the Page connection and Messenger need,
   typically `pages_messaging`, `pages_show_list`, `pages_manage_metadata` and
   `pages_read_engagement`. Each needs a written use case and a screencast of
   the flow. The MVP plan targets submission by the end of week 4. The sign-in
   app's `public_profile` and `email` need no review.
4. Switch **both** apps from **Development** to **Live** with the toggle at the
   top of the dashboard.
5. Remember the Messenger **24-hour window**: a Page may reply freely only
   within 24 hours of the customer's last message.
