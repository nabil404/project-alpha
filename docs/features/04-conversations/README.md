# 04 · Conversations

How Messenger conversations reach the seller's dashboard. Scope comes from the
MVP's [scope](../../mvp/01-messenger-to-order/scope.md) ("conversation viewer",
"human handoff, and bot auto-pause when the seller replies manually"). This
page describes what is built.

**Status (Sep 2026):** inbound messages and seller echoes are stored by the
worker; the API lists, searches, counts and shows conversations, marks them
read, takes over and hands back, sends seller replies, and streams changes
over SSE. Not built yet: assistant replies (AI work), the drafted-order panel
and order history (orders work), and the web route.

## Flow

```
Meta  POST /api/v1/webhooks/messenger        → verified, one BullMQ job per message (jobId = mid)
Worker InboundMessageIngest                   → app_page_merchant(pageId) → merchant
       read customer + Page, Graph profile   (outside any transaction)
       one withMerchant transaction          → upsert customer, lock/create conversation,
                                                insert message (ON CONFLICT DO NOTHING),
                                                move last_* forward; seller echo → bot_paused
       after commit                          → PUBLISH conversation-events {merchantId, conversationId, kind}
API    ConversationEventsHub (lazy SUBSCRIBE) → that merchant's SSE streams: conversation.updated {conversationId}
SPA    refetches over REST
```

## Routes (`/api/v1/conversations`, session + TenantGuard)

| Route                |                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`              | `filter` (`all`, `needs_you`, `drafted`, `unread`), `q`, `cursor`, `limit` ≤ 50; newest activity first                                                    |
| `GET /counts`        | `{ all, needsYou, drafted, unread }`, ignoring `q`                                                                                                        |
| `GET /events`        | SSE: `ready` (retry 5 s), `conversation.updated`, `ping` every 25 s; ends at session expiry; ≤ 5 per shop (the oldest stream is ended when a sixth opens) |
| `GET /:id`           | detail with `replyWindowClosesAt`                                                                                                                         |
| `GET /:id/messages`  | newest page, oldest first; `before` for older                                                                                                             |
| `PUT /:id/read`      | 204                                                                                                                                                       |
| `PATCH /:id`         | `{ botPaused }`: take over / hand back                                                                                                                    |
| `POST /:id/messages` | `{ text }` ≤ 2000: seller reply                                                                                                                           |

- **Two different "the assistant is off" facts.** `bot_paused` is the seller's
  takeover (Take over, a dashboard reply, or a reply from Facebook's own inbox).
  `state = handed_off` is the assistant giving up, and is what "Needs you" shows.
  Handing back clears the first and resumes the second from its collected details.
  The assistant resumes only on Hand back.
- **24-hour window.** Replies are refused with `409 MESSENGER_WINDOW_CLOSED` 24 h
  after the customer's last message; no `HUMAN_AGENT` tag.
- **Pages.** Conversations key on Facebook's Page id, not the `facebook_page`
  row, so disconnecting and reconnecting the same Page keeps its threads.
  Replying needs the conversation's Page to be the one connected now
  (`409 MESSENGER_PAGE_NOT_CONNECTED`).
- **The Page resolver.** `app_page_merchant(text)` is `SECURITY DEFINER`, owned
  by the `NOLOGIN` role `app_page_resolver`, which may only `SELECT` `page_id`
  and `merchant_id` from `facebook_page` (policy `facebook_page_resolver_read`).
- **Search** is `ILIKE` over `pg_trgm` GIN indexes on `customer.name` and
  `message.text`; `%`, `_` and `\` are matched literally.
- **Pagination** is a keyset cursor on `(last_message_at, id)`, deliberately not
  `page`/`limit`: the list re-sorts whenever a message arrives.
- **Caddy** leaves `/api/v1/conversations/events` out of `encode`.

## Follow-ups

- Queue the assistant's turn from `InboundMessageIngest` (AI work).
- Drafted-order panel and customer order history; settle the design's seller
  "Confirm order" against the rule that only the customer confirms.
- Per-shop auto-resume after a takeover (Never / 1 h / 24 h) in Settings ›
  Assistant, once the settings API exists.
- The Conversations web route, using the SSE contract above.
- The web client must stop reconnecting when the server evicts a stream (more
  than 5 open tabs), or tabs will evict each other in a loop.
- `HUMAN_AGENT` tag after App Review, if pilots ask for it.
- `WORKER_CONCURRENCY` is not yet applied to the inbound processor (BullMQ's
  default of 1 is used).
- The Caddyfile change (`@compressible not path …`) has not been run through
  `caddy validate`; validate before deploying.
