# Meta (Facebook) setup

How to create the Meta app behind "Continue with Facebook" and the Messenger
webhook, and fill:

```dotenv
# ---- Auth ----
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=

# ---- Meta ----
META_APP_SECRET=
META_VERIFY_TOKEN=
META_GRAPH_VERSION=v21.0
```

`FACEBOOK_*` are optional: without them only the Facebook button fails.
`META_*` are **required**; the API refuses to boot without them
([`env.schema.ts`](../../apps/api/src/config/env.schema.ts)).

Meta renames App Dashboard menus often. If a label below has moved, look for
the product name ("Facebook Login", "Messenger", "Webhooks") in the left
sidebar or the app's **Use cases** page.

## One app, not two

Create **one** Meta app and use it for everything: Facebook sign-in, the
(upcoming) Page connection flow, and the Messenger webhook. Page access tokens
and webhook subscriptions belong to the app that obtained them, so splitting
sign-in and Messenger across two apps would break the Page connection later.

That makes the variables overlap:

| Variable                 | Value                           | Read by                                                                                                       |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FACEBOOK_CLIENT_ID`     | App ID                          | Better Auth ([`auth.config.ts`](../../apps/api/src/auth/auth.config.ts))                                      |
| `FACEBOOK_CLIENT_SECRET` | App Secret                      | Better Auth                                                                                                   |
| `META_APP_SECRET`        | **The same** App Secret         | Webhook signature check ([`signature.ts`](../../apps/api/src/modules/messenger/signature.ts))                 |
| `META_VERIFY_TOKEN`      | A random string you invent      | Webhook handshake ([`messenger.controller.ts`](../../apps/api/src/modules/messenger/messenger.controller.ts)) |
| `META_GRAPH_VERSION`     | Graph API version, e.g. `v21.0` | Graph API calls                                                                                               |

## What the app expects

| Purpose                     | URL (local dev)                                       | URL (production)                                      |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Facebook Login redirect URI | `http://localhost:5173/api/v1/auth/callback/facebook` | `https://<your-domain>/api/v1/auth/callback/facebook` |
| Messenger webhook callback  | `https://<tunnel-host>/api/v1/webhooks/messenger`     | `https://<your-domain>/api/v1/webhooks/messenger`     |
| Privacy policy              | —                                                     | `https://<your-domain>/privacy`                       |
| Terms of service            | —                                                     | `https://<your-domain>/terms`                         |
| Data deletion instructions  | —                                                     | `https://<your-domain>/data-deletion`                 |

- Better Auth is mounted on the SPA's origin (`APP_URL`) under `/api/v1/auth`.
  Use the Vite origin `:5173` locally, never the API's `:3000`, or Better Auth
  rejects the flow with `INVALID_ORIGIN`.
- Facebook sign-in asks for `public_profile` and `email` only. Page
  permissions (`pages_messaging` and related) are requested later, in the
  separate Page connection step, never at sign-in
  ([auth feature doc](../features/01-auth/README.md)).
- Facebook identities never link automatically to an existing account by
  email, because Facebook does not guarantee a verified address.
- The webhook needs a public HTTPS URL, even in development (see
  [step 7](#7-subscribe-the-messenger-webhook)).
- Caddy serves the privacy, terms and data-deletion pages
  ([`docker/Caddyfile`](../../docker/Caddyfile)); Meta requires them before
  App Review.

## Steps

### 1. Prerequisites

- A personal Facebook account with two-factor authentication on.
- A **Meta developer account**: open <https://developers.facebook.com/>,
  click **Get Started**, and verify your phone and email.
- A **Business portfolio** (formerly Business Manager) at
  <https://business.facebook.com/>. Business Verification and advanced access
  to Page permissions are granted to the portfolio, so start it early; the MVP
  plan calls for it in week 1
  ([meta requirements](../mvp/01-messenger-to-order/meta-requirements.md)).
- A **test Facebook Page** you administer, for receiving Messenger messages.

### 2. Create the app

1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. App name: for example `Messenger to Order (dev)`. Contact email: a team
   inbox.
3. **Use cases:** select both
   - **Authenticate and request data from users with Facebook Login**, and
   - **Engage with customers on Messenger from Meta**.

   If the dashboard asks for an app type instead, choose **Business**.

4. **Business:** connect the Business portfolio from step 1.
5. Finish the wizard. The app starts in **Development** mode: only people with
   a role on the app can use it (see [step 8](#8-roles-and-testers)).

### 3. Copy the App ID and App Secret

Open **App settings → Basic**.

1. **App ID** → `FACEBOOK_CLIENT_ID`.
2. **App secret** → click **Show**, re-enter your password, and copy it into
   **both** `FACEBOOK_CLIENT_SECRET` and `META_APP_SECRET`.

While you are on this page, fill in what App Review will require anyway:

- **App domains:** `<your-domain>`.
- **Privacy policy URL:** `https://<your-domain>/privacy`.
- **Terms of service URL:** `https://<your-domain>/terms`.
- **User data deletion:** choose **Data deletion instructions URL** and enter
  `https://<your-domain>/data-deletion`.
- **App icon** (1024×1024) and **Category** (for example "Business and
  pages").
- Click **Save changes**.

If the App Secret ever leaks, use **Reset** on this page, then update both
variables everywhere and restart the API and worker.

### 4. Configure Facebook Login

Open **Use cases → Authenticate and request data from users with Facebook
Login → Customize** (older dashboards: **Facebook Login → Settings**).

1. **Permissions:** make sure `public_profile` and `email` are added. `email`
   may need **Add** clicked explicitly.
2. **Settings:**
   - **Client OAuth login:** Yes.
   - **Web OAuth login:** Yes.
   - **Enforce HTTPS:** Yes (localhost is exempt while the app is in
     Development mode).
   - **Use Strict Mode for redirect URIs:** Yes.
   - **Valid OAuth Redirect URIs:**
     `http://localhost:5173/api/v1/auth/callback/facebook` (add the production
     URI to the production app).
3. **Save changes.**

### 5. Generate `META_VERIFY_TOKEN`

The verify token is a shared secret **you** invent. Meta sends it back once,
when you subscribe the webhook, and the API compares it to
`META_VERIFY_TOKEN`.

```bash
openssl rand -hex 32
```

Put the output in `apps/api/.env` **before** subscribing the webhook, and
restart the API.

### 6. Choose `META_GRAPH_VERSION`

The default `v21.0` is fine to start. To pin the version your app was created
on, read it from **App settings → Advanced → Upgrade API version** (or the
version picker in the Graph API Explorer).

- The format must be `vNN.N`; anything else fails env validation at boot.
- Meta retires each version about two years after release. Check the
  [changelog](https://developers.facebook.com/docs/graph-api/changelog) and
  bump this value before the version you use is deprecated.

### 7. Subscribe the Messenger webhook

Meta calls the webhook from the internet over HTTPS, so locally you need a
tunnel to your machine.

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

   If Vite rejects the tunnel host ("Blocked request. This host is not
   allowed"), point the tunnel at the API directly instead
   (`http://localhost:3000`); the webhook path is the same.

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
   - `messages` (customer messages, and the seller's own replies as echoes),
   - `messaging_postbacks`.

   The API currently acts on text `messages` only; other fields are
   acknowledged and ignored.

6. Under **Generate access tokens**, click **Add or connect Pages**, pick your
   test Page and grant the requested permissions. This subscribes the Page to
   the app, so its messages reach the webhook.

The in-app Page connection flow is not built yet. If you generate a Page
access token here for manual testing, treat it as a secret: never commit it,
paste it in an issue, or log it.

### 8. Roles and testers

While the app is in Development mode, only people with a role on it can sign
in with Facebook or have their messages delivered to the webhook.

Open **App roles → Roles** and add each developer as **Administrator**,
**Developer** or **Tester**. They must accept the invitation at
<https://developers.facebook.com/requests>.

### 9. Fill the env file

In `apps/api/.env`:

```dotenv
# ---- Auth ----
FACEBOOK_CLIENT_ID=123456789012345
FACEBOOK_CLIENT_SECRET=0123456789abcdef0123456789abcdef

# ---- Meta ----
META_APP_SECRET=0123456789abcdef0123456789abcdef
META_VERIFY_TOKEN=<output of openssl rand -hex 32>
META_GRAPH_VERSION=v21.0
```

A `$` in any value must be written `$$`: compose interpolates this file.
Restart the API and the worker after any change.

### 10. Verify

1. **Sign-in:** open <http://localhost:5173/sign-in>, click the Facebook
   button, and sign in with an account that has a role on the app. You should
   land in the dashboard.
2. **Handshake:** **Verify and save** in step 7 succeeded.
3. **Delivery:** from a personal account with a role on the app, send a text
   message to the test Page. The API answers `EVENT_RECEIVED` and the worker
   log shows the `inbound-message` job. The dashboard's **Test** button next to
   a webhook field sends a sample payload too.

## Troubleshooting

| Symptom                                                                         | Cause and fix                                                                                                                                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "URL blocked: This redirect failed because the redirect URI is not whitelisted" | The Facebook Login redirect URI is missing or differs from `${APP_URL}/api/v1/auth/callback/facebook`. With Strict Mode on, it must match exactly.                         |
| "App not active" / "Feature unavailable"                                        | The app is in Development mode and your account has no role on it. Add it in [step 8](#8-roles-and-testers).                                                               |
| `INVALID_ORIGIN` from the API                                                   | The flow was started from `localhost:3000`. Use `localhost:5173`.                                                                                                          |
| Sign-in succeeds but no email arrives on the user                               | The Facebook account has no confirmed email, or `email` was not granted. Check the permission in [step 4](#4-configure-facebook-login).                                    |
| "The callback URL or verify token couldn't be validated"                        | Tunnel down or wrong host, or the API answered 401 `WEBHOOK_VERIFICATION_FAILED` because the token differs from `META_VERIFY_TOKEN`. Restart the API after editing `.env`. |
| Every webhook POST answers 401 `WEBHOOK_INVALID_SIGNATURE`                      | `META_APP_SECRET` is not this app's App Secret (a different app, or reset since). Copy it again from **App settings → Basic**.                                             |
| Handshake works but no messages arrive                                          | The Page is not connected ([step 7.6](#7-subscribe-the-messenger-webhook)), `messages` is not subscribed, or the sender has no role on a Development-mode app.             |
| API refuses to boot: `META_GRAPH_VERSION`                                       | The value is not in `vNN.N` form.                                                                                                                                          |

## Environments

Create a separate Meta app per environment (for example `Messenger to Order
(dev)` and `Messenger to Order`), each with its own redirect URI, webhook URL,
App Secret and verify token. A leaked development secret then cannot forge
production webhooks.

## Going live

Before real sellers can connect Pages and receive customer messages:

1. **Business Verification** of the Business portfolio (**Business settings →
   Security Center**). It can take days to weeks; start it in week 1.
2. Make sure the privacy policy, terms and data-deletion pages are live on the
   production domain.
3. **App Review** (**App Review → Requests**) for advanced access to the
   permissions the Page connection and Messenger need, typically
   `pages_messaging`, `pages_show_list`, `pages_manage_metadata` and
   `pages_read_engagement`. Each needs a written use case and a screencast of
   the flow. The MVP plan targets submission by the end of week 4.
   `public_profile` and `email` need no review.
4. Switch the app from **Development** to **Live** with the toggle at the top
   of the dashboard.
5. Remember the Messenger **24-hour window**: a Page may reply freely only
   within 24 hours of the customer's last message.
