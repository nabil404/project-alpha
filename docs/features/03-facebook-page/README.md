# 03 · Connect Facebook Page

How a signed-in seller connects the Facebook Page whose Messenger chats become
orders. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) ("Connect Facebook Page: a
separate step after sign-in that requests Page permissions"). This page
describes what is built.

**Status (Oct 2026):** connect, reconnect and disconnect work end to end, in
the API and in Settings › Messenger (`/settings/messenger`). Not built yet:
the bot on/off toggle (the column exists), and the Replies settings in the
design. See [Follow-ups](#follow-ups).

A webhook's Page is resolved to its shop by `app_page_merchant()`; see
[04 · Conversations](../04-conversations/README.md).

## Flow

```
SPA  GET  /api/v1/messenger/page                 → { page } (null until one is connected)
SPA  POST /api/v1/messenger/page/authorizations  → { url }, sets page_connect cookie (state)
 ↓   browser → Facebook Login dialog (pages_show_list, pages_messaging, pages_manage_metadata)
API  GET  /api/v1/messenger/page/oauth/callback  → checks state, code → long-lived user token,
     checks every permission was granted, re-seals the cookie with the user token,
     302 → /settings/messenger?step=choose-page   (or ?error=<ErrorCode>)
SPA  GET  /api/v1/messenger/page/candidates      → the seller's Pages, canMessage per Page
SPA  PUT  /api/v1/messenger/page { pageId }      → Page token fetched, app subscribed to the
     Page's webhooks, token encrypted and stored; the cookie is cleared
SPA  DELETE /api/v1/messenger/page               → row deleted, then unsubscribe (best-effort)
```

- **Flow state** lives in one httpOnly, `SameSite=Lax` cookie scoped to
  `/api/v1/messenger/page`, encrypted with `CryptoService` and bound to the
  seller and shop that started it, valid 15 minutes. No server-side store.
- **Graph API** calls go through `MetaGraphClient` (`fetch`, pinned
  `META_GRAPH_VERSION`), tokens in the `Authorization` header with
  `appsecret_proof`, never inside a transaction. Errors carry no URL or token.
- **Credentials:** the Messenger app, `META_APP_ID` / `META_APP_SECRET`, not
  the Facebook sign-in app: Page tokens and webhook subscriptions belong to the
  app that obtained them, and the webhook verifies signatures with
  `META_APP_SECRET` ([meta setup](../../setup/meta-setup.md)). Without
  `META_APP_ID` the API boots and connecting answers
  `MESSENGER_NOT_CONFIGURED`. The Messenger app must list
  `${APP_URL}/api/v1/messenger/page/oauth/callback` as a valid OAuth redirect
  URI.

## Routes (`/api/v1/messenger/page`, session + TenantGuard)

In
[`facebook-page.controller.ts`](../../../apps/api/src/modules/messenger/page/facebook-page.controller.ts);
shapes in
[`packages/shared/src/schemas/messenger.ts`](../../../packages/shared/src/schemas/messenger.ts).

| Route                  | Request      | Response                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                | —            | `{ page: FacebookPage \| null }`                                                                                                                                                                                                                                                                                      |
| `POST /authorizations` | —            | `{ url }` for the Facebook Login dialog; 503 `MESSENGER_NOT_CONFIGURED`. Throttled to 10 a minute                                                                                                                                                                                                                     |
| `GET /oauth/callback`  | Facebook's   | 302 to `/settings/messenger?step=choose-page`, or `?error=<code>`. Not called by clients                                                                                                                                                                                                                              |
| `GET /candidates`      | —            | `{ pages: [{ pageId, name, canMessage }] }`; 400 `FACEBOOK_AUTH_EXPIRED`, 503 `MESSENGER_NOT_CONFIGURED` / `FACEBOOK_UNAVAILABLE`                                                                                                                                                                                     |
| `PUT /`                | `{ pageId }` | 200 `FacebookPage`; 400 `VALIDATION_FAILED` / `FACEBOOK_AUTH_EXPIRED` / `FACEBOOK_AUTH_FAILED` / `FACEBOOK_PAGE_NO_MESSAGING_ACCESS`, 404 `FACEBOOK_PAGE_NOT_FOUND`, 409 `FACEBOOK_PAGE_TAKEN` / `FACEBOOK_PAGE_ALREADY_CONNECTED`, 503 `MESSENGER_NOT_CONFIGURED` / `FACEBOOK_UNAVAILABLE`. Throttled to 10 a minute |
| `DELETE /`             | —            | 204, also when nothing was connected                                                                                                                                                                                                                                                                                  |

`FacebookPage` is `{ id, pageId, name, botEnabled, connectedAt }`; the token
never leaves the API. `canMessage` is false when the seller's role on the Page
lacks `MESSAGING`, which the assistant needs to answer chats.

## Data model

`facebook_page` ([`schema/pages.ts`](../../../apps/api/src/modules/database/schema/pages.ts)):
`merchant_id`, `page_id`, `name`, `access_token` (ciphertext), `bot_enabled`.
`UNIQUE (page_id)` globally, the one deliberate exception to per-merchant
uniqueness, and `UNIQUE (merchant_id)`: one Page per shop in the MVP. RLS is
enabled and forced. One more policy, `facebook_page_resolver_read`, lets the
Page resolver's role read `page_id` and `merchant_id` only (it holds a column
grant on just those two); see
[Conversations](../04-conversations/README.md#data-model).

## Rules

On the OAuth callback the code arrives as `?error=` on the redirect; on the
JSON routes, in the error envelope with the status shown.

| Situation                                         | Status | Answer                              |
| ------------------------------------------------- | ------ | ----------------------------------- |
| Messenger app not configured (`META_APP_ID`)      | 503    | `MESSENGER_NOT_CONFIGURED`          |
| Seller cancels on Facebook                        | 400    | `FACEBOOK_AUTH_CANCELLED`           |
| State mismatch, code rejected                     | 400    | `FACEBOOK_AUTH_FAILED`              |
| No, expired or foreign flow cookie; revoked token | 400    | `FACEBOOK_AUTH_EXPIRED`             |
| A Page permission unticked                        | 400    | `FACEBOOK_PERMISSIONS_DECLINED`     |
| Page not among those granted                      | 404    | `FACEBOOK_PAGE_NOT_FOUND`           |
| Seller's role lacks `MESSAGING`                   | 400    | `FACEBOOK_PAGE_NO_MESSAGING_ACCESS` |
| Page connected to another shop                    | 409    | `FACEBOOK_PAGE_TAKEN`               |
| Shop already has a different Page                 | 409    | `FACEBOOK_PAGE_ALREADY_CONNECTED`   |
| Facebook 5xx or unreachable                       | 503    | `FACEBOOK_UNAVAILABLE`              |
| Connecting the shop's own Page again (reconnect)  | 200    | Name and token refreshed            |

- **Disconnect** deletes the row first, then unsubscribes the app from the
  Page's webhooks, best-effort. Conversations stay: they key on Facebook's Page
  id ([Conversations](../04-conversations/README.md#rules)), so reconnecting
  the same Page brings its threads back.
- **Webhook fields** subscribed on connect: `messages`, `messaging_postbacks`,
  `message_echoes`. The webhook itself is in
  [Conversations](../04-conversations/README.md#webhook).

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts),
set in `apps/api/.env`. Setting up the Meta app:
[meta setup](../../setup/meta-setup.md).

| Variable               | Required | Notes                                                                                          |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `META_APP_ID`          | no       | The Messenger app; without it the API boots and connecting answers `MESSENGER_NOT_CONFIGURED`  |
| `META_APP_SECRET`      | yes      | `appsecret_proof` on Graph calls, and the webhook's signature key                              |
| `META_GRAPH_VERSION`   | yes      | Pinned Graph API version, e.g. `v21.0`                                                         |
| `TOKEN_ENCRYPTION_KEY` | yes      | 32 bytes, base64. `CryptoService` encrypts Page tokens (AES-256-GCM) and seals the flow cookie |

## Tests

[`messenger/page/__tests__/`](../../../apps/api/src/modules/messenger/page/__tests__/):
the controller (cookie and redirects), the service (the OAuth round trip,
candidates, connect, disconnect, two merchants), `MetaGraphClient` (requests,
`appsecret_proof`, error mapping, no token in errors) and the flow cookie
(sealing, expiry, binding to the seller and shop).

## Follow-ups

- **Bot on/off toggle.** `facebook_page.bot_enabled` exists (default `true`)
  and is returned, but nothing sets or reads it yet. The assistant's turn must
  honour it ([Conversations](../04-conversations/README.md#follow-ups)).
- **Replies settings** from the design (Settings › Messenger).
