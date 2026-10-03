# 03 · Connect Facebook Page

How a signed-in seller connects the Facebook Page whose Messenger chats become
orders. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) ("Connect Facebook Page: a
separate step after sign-in that requests Page permissions"). This page
describes what is built.

**Status (Sep 2026):** connect, reconnect and disconnect work end to end, in
the API and in Settings › Messenger. Not built yet: the bot on/off toggle (the
column exists), and the Replies settings in the design.

A webhook's Page is resolved to its shop by `app_page_merchant()`; see
[04 · Conversations](../04-conversations/README.md).

## Flow

```
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

| Situation                                         | Answer                              |
| ------------------------------------------------- | ----------------------------------- |
| Seller cancels on Facebook                        | `FACEBOOK_AUTH_CANCELLED`           |
| State mismatch, code rejected                     | `FACEBOOK_AUTH_FAILED`              |
| No, expired or foreign flow cookie; revoked token | `FACEBOOK_AUTH_EXPIRED`             |
| A Page permission unticked                        | `FACEBOOK_PERMISSIONS_DECLINED`     |
| Page not among those granted                      | `FACEBOOK_PAGE_NOT_FOUND`           |
| Seller's role lacks `MESSAGING`                   | `FACEBOOK_PAGE_NO_MESSAGING_ACCESS` |
| Page connected to another shop                    | `FACEBOOK_PAGE_TAKEN`               |
| Shop already has a different Page                 | `FACEBOOK_PAGE_ALREADY_CONNECTED`   |
| Facebook 5xx or unreachable                       | `FACEBOOK_UNAVAILABLE`              |
| Connecting the shop's own Page again (reconnect)  | Name and token refreshed            |
