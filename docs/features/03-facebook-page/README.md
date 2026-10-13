# 03 · Connect Facebook Page

How a signed-in seller connects the Facebook Page whose Messenger chats become
orders: "a separate step after sign-in that requests Page permissions"
([scope](../../mvp/01-messenger-to-order/scope.md)).

**Status (Oct 2026):** connect, reconnect and disconnect work in the API and
at **Settings › Messenger** (`/settings/messenger`). Not built: the bot on/off
toggle and the design's Replies settings ([Follow-ups](#follow-ups)). Webhooks
resolve their Page to a shop through `app_page_merchant()`
([04 · Conversations](../04-conversations/README.md)).

## Connecting takes four requests

[Connect flow](connect-flow.md) draws them as a sequence diagram.

1. `POST /authorizations` sets the `page_connect` cookie and returns the
   Facebook Login dialog URL, asking for `pages_show_list`, `pages_messaging`
   and `pages_manage_metadata`.
2. Facebook redirects to `GET /oauth/callback`. The API checks `state`, trades
   the code for a long-lived user token, and confirms every permission was
   granted. It re-seals the cookie with the token and redirects to
   `/settings/messenger?step=choose-page`; on failure it clears the cookie and
   redirects to `?error=<ErrorCode>`.
3. `GET /candidates` lists the seller's Pages with `canMessage` for each.
4. `PUT /` with the chosen `pageId` fetches the Page token, subscribes the app
   to the Page's webhooks, stores the token encrypted, and clears the cookie.

`DELETE /` deletes the row, then unsubscribes the app, best-effort.

### Flow state lives in one cookie

The API keeps no flow state; the `page_connect` cookie carries it.

- `CryptoService` encrypts it, so the browser can neither read nor change it.
- It is `httpOnly`, `SameSite=Lax` (Facebook's redirect back is a cross-site
  navigation), scoped to `/api/v1/messenger/page`, and `Secure` when
  `APP_URL` is `https`.
- It is bound to the seller and shop that started the flow and expires after
  15 minutes. `openFlow()` treats a missing, tampered, expired or foreign
  cookie alike: start again.
- Its stage is `authorizing` (holding the OAuth `state`) or `authorized`
  (holding the user token).

### Graph API calls

`MetaGraphClient` calls the Graph API over `fetch` at the pinned
`META_GRAPH_VERSION`, with a 10-second timeout, never inside a transaction.

- A call with a token sends it in the `Authorization` header plus
  `appsecret_proof`; the code exchange, which has no token yet, sends
  `client_secret`.
- `GraphError` carries Facebook's status and error code, never the URL or a
  token, and masks token-shaped text in Facebook's message.
- It reads the first 100 Pages from `/me/accounts`, with each Page token and
  the seller's `tasks` (not a field of the Page node).
- Page tokens read with a long-lived user token do not expire.

### The Messenger app, not the sign-in app

Page connection uses the Messenger app (`META_APP_ID`, `META_APP_SECRET`).
Page tokens and webhook subscriptions belong to the app that obtained them,
and the webhook checks signatures with `META_APP_SECRET`. That app must list
`${APP_URL}/api/v1/messenger/page/oauth/callback` as a valid OAuth redirect
URI ([Meta setup](../../setup/meta-setup.md)).

## Routes (`/api/v1/messenger/page`, session and `TenantGuard`)

[`facebook-page.controller.ts`](../../../apps/api/src/modules/messenger/page/facebook-page.controller.ts);
shapes in
[`packages/shared/src/schemas/messenger.ts`](../../../packages/shared/src/schemas/messenger.ts).

| Route                  | Request      | Response                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                | none         | `{ page: FacebookPage \| null }`                                                                                                                                                                                                                                                                                        |
| `POST /authorizations` | none         | 201 `{ url }` for the Facebook Login dialog. 503 `MESSENGER_NOT_CONFIGURED`. Throttled to 10 a minute                                                                                                                                                                                                                   |
| `GET /oauth/callback`  | Facebook's   | 302 to `/settings/messenger?step=choose-page`, or to `?error=<code>`. Facebook calls it, not clients                                                                                                                                                                                                                    |
| `GET /candidates`      | none         | `{ pages: [{ pageId, name, canMessage }] }`, sorted by name. 400 `FACEBOOK_AUTH_EXPIRED` or `FACEBOOK_AUTH_FAILED`. 503 `MESSENGER_NOT_CONFIGURED` or `FACEBOOK_UNAVAILABLE`                                                                                                                                            |
| `PUT /`                | `{ pageId }` | 200 `FacebookPage`. 400 `VALIDATION_FAILED`, `FACEBOOK_AUTH_EXPIRED`, `FACEBOOK_AUTH_FAILED`, or `FACEBOOK_PAGE_NO_MESSAGING_ACCESS`. 404 `FACEBOOK_PAGE_NOT_FOUND`. 409 `FACEBOOK_PAGE_TAKEN` or `FACEBOOK_PAGE_ALREADY_CONNECTED`. 503 `MESSENGER_NOT_CONFIGURED` or `FACEBOOK_UNAVAILABLE`. Throttled to 10 a minute |
| `DELETE /`             | none         | 204, also when no Page was connected                                                                                                                                                                                                                                                                                    |

- `FacebookPage` is `{ id, pageId, name, botEnabled, connectedAt }`; the token
  never leaves the API. `connectedAt` is the row's `created_at`, so a
  reconnect keeps the first connection's time. `pageId` is 1 to 32 digits.
- `canMessage` is false when the seller's role on the Page lacks the
  `MESSAGING` task the assistant needs.
- The callback is behind the session guard too, so without a session it gets
  a 401 envelope, not a redirect.

## Data model

`facebook_page`
([`schema/pages.ts`](../../../apps/api/src/modules/database/schema/pages.ts)):
`merchant_id`, `page_id`, `name`, `access_token` (`CryptoService`
ciphertext), `bot_enabled`, `created_at`, `updated_at`.

- `facebook_page_page_id_uq` makes `page_id` unique across all shops, the one
  uniqueness rule without `merchant_id`, because a webhook resolves Page to
  shop with no session.
- `facebook_page_merchant_uq`: one Page per shop in the MVP.
- RLS is enabled and forced with `facebook_page_merchant_isolation`. A second
  policy, `facebook_page_resolver_read`, lets the `app_page_resolver` role,
  which has a column grant on `page_id` and `merchant_id` only, read rows
  ([Conversations](../04-conversations/README.md#data-model)).

## Rules

The callback sends the error code as `?error=` on its redirect; the JSON
routes send it in the envelope with the status shown.

| Situation                                                               | Status | Answer                              |
| ----------------------------------------------------------------------- | ------ | ----------------------------------- |
| `META_APP_ID` is not set                                                | 503    | `MESSENGER_NOT_CONFIGURED`          |
| Seller cancels on Facebook                                              | 400    | `FACEBOOK_AUTH_CANCELLED`           |
| `state` does not match, no code, or Facebook rejects the request        | 400    | `FACEBOOK_AUTH_FAILED`              |
| Flow cookie missing, expired, or foreign. Or the user token was revoked | 400    | `FACEBOOK_AUTH_EXPIRED`             |
| The seller unticked a Page permission                                   | 400    | `FACEBOOK_PERMISSIONS_DECLINED`     |
| The Page is not among those the seller granted                          | 404    | `FACEBOOK_PAGE_NOT_FOUND`           |
| The seller's role on the Page lacks `MESSAGING`                         | 400    | `FACEBOOK_PAGE_NO_MESSAGING_ACCESS` |
| Another shop has the Page                                               | 409    | `FACEBOOK_PAGE_TAKEN`               |
| The shop already has a different Page                                   | 409    | `FACEBOOK_PAGE_ALREADY_CONNECTED`   |
| Facebook answers 5xx, times out, or cannot be reached                   | 503    | `FACEBOOK_UNAVAILABLE`              |
| The shop connects its own Page again (a reconnect)                      | 200    | Name and token refreshed            |

- **`state` is checked first**, so a cancel with a wrong `state` reports
  `FACEBOOK_AUTH_FAILED`. An error without a code of its own redirects with
  `INTERNAL_SERVER_ERROR`.
- **The dialog asks again.** The Login URL sets `auth_type=rerequest`, so a
  declined permission is requested on the next try.
- **Connect subscribes before it stores.** If the write then fails with
  `FACEBOOK_PAGE_TAKEN`, the subscription stays, since the other shop needs
  it.
- **Disconnect** logs and ignores a failed unsubscribe: with the row gone,
  the Page's webhooks resolve to no shop and are dropped. Without
  `META_APP_ID` it only deletes the row.
- **Conversations survive a disconnect.** They key on Facebook's Page id
  ([Conversations](../04-conversations/README.md#rules)), so reconnecting the
  same Page brings its threads back.
- **Webhook fields** subscribed on connect: `messages`, `messaging_postbacks`
  and `message_echoes` ([webhook](../04-conversations/README.md#webhook)).

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts),
set in `environments/.env`.

| Variable               | Required | Notes                                                                                            |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `META_APP_ID`          | no       | The Messenger app. Without it the API boots and connecting answers `MESSENGER_NOT_CONFIGURED`    |
| `META_APP_SECRET`      | yes      | `appsecret_proof` on Graph calls, and the webhook's signature key                                |
| `META_GRAPH_VERSION`   | yes      | Pinned Graph API version, such as `v21.0`                                                        |
| `TOKEN_ENCRYPTION_KEY` | yes      | 32 bytes, base64. `CryptoService` encrypts Page tokens (AES-256-GCM) and seals the flow cookie   |
| `APP_URL`              | yes      | Base of the OAuth redirect URI and of the callback's redirect. `https` makes the cookie `Secure` |

## Tests

In [`messenger/page/__tests__/`](../../../apps/api/src/modules/messenger/page/__tests__/):

- `facebook-page.controller.spec.ts`: the cookie's options and the callback's
  redirects.
- `facebook-page.service.spec.ts`: the OAuth round trip, candidates, connect,
  reconnect, disconnect, and two-shop isolation. Skipped without
  `TEST_DATABASE_ADMIN_URL`.
- `meta-graph.client.spec.ts`: requests, `appsecret_proof`, error mapping, no
  token in errors, and the Messenger send calls Conversations uses.
- `page-connect-flow.spec.ts`: sealing, expiry, binding to seller and shop,
  the `state` comparison, and `readCookie`.

## Follow-ups

- **Bot on/off toggle.** `facebook_page.bot_enabled` defaults to `true` and is
  returned as `botEnabled`. Ingestion queues an assistant turn only when it is
  `true`, but no route or screen sets it.
- **Replies settings** from the design (**Settings › Messenger**).
