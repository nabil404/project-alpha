# 04 · Conversations

How Messenger conversations reach the seller's dashboard. Scope comes from the
MVP's [scope](../../mvp/01-messenger-to-order/scope.md) ("conversation viewer",
"human handoff, and bot auto-pause when the seller replies manually"). This
page describes what is built.

**Status (Sep 2026):** inbound messages and seller echoes are stored by the
worker; the API lists, searches, counts and shows conversations, marks them
read, takes over and hands back, sends seller replies, and streams changes
over SSE. Not built yet: assistant replies (AI work), the drafted-order panel
and order history (orders work), and the web route (the sidebar item exists,
disabled).

## Flow

```
Meta  POST /api/v1/webhooks/messenger        → verified, one BullMQ job per text message (jobId = mid)
                                                customer-message | page-echo (is_echo; customer = recipient)
Worker InboundMessageIngest                   → echo carrying our META_APP_ID → skipped (own-echo)
                                              → app_page_merchant(pageId) → merchant, or dropped (unknown-page)
       read customer + Page, Graph profile   (outside any transaction)
       one withMerchant transaction          → upsert customer, lock/create conversation,
                                                insert message (ON CONFLICT DO NOTHING → duplicate),
                                                move last_* forward; seller echo → bot_paused
       after commit                          → PUBLISH conversation-events {merchantId, conversationId, kind}
API    PUT read / PATCH / POST messages      → PUBLISH the same event after their commit
API    ConversationEventsHub (lazy SUBSCRIBE) → that merchant's SSE streams: conversation.updated {conversationId}
SPA    refetches over REST
```

- **Text only.** A webhook event without `message.text` (attachments,
  stickers, reactions, deliveries, postbacks) makes no job, so an image-only
  first message creates no customer or conversation.
- **Seller echoes.** An echo whose `app_id` is not ours (Facebook's own inbox,
  or another app on the Page) is stored as `sender = seller` and pauses the
  assistant. Our own sends are written by the sender, not the ingest.
- **Dedupe, two layers.** `jobId = mid` drops a repeat while the completed job
  is kept (1 h or 1000 jobs); `UNIQUE (merchant_id, meta_message_id)` with
  `ON CONFLICT DO NOTHING` is the backstop. A duplicate publishes nothing.
- **Failures.** An unknown job name or a malformed payload fails once
  (`UnrecoverableError`; the log names field paths, never values). Anything
  else retries with the queue defaults: 5 attempts, exponential from 1 s.
- **Customer name.** `GET /{psid}?fields=name` with the connected Page's token,
  outside any transaction, when the customer is new, or has no name and was
  last tried 24 h or more ago (`needsProfile`). A known name is never
  refreshed; a Graph failure stores the message with `name = null`.

## Routes (`/api/v1/conversations`, session + TenantGuard)

A non-UUID `:id` is `400 VALIDATION_FAILED`; an unknown id, or another shop's,
is `404 CONVERSATION_NOT_FOUND` (never 403).

| Route                | Request                                                                                                    | Response                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`              | `filter` (`all` default, `needs_you`, `drafted`, `unread`), `q` ≤ 100, `cursor`, `limit` 1–50 (default 25) | `{ data: ConversationListItem[], pagination: { nextCursor } }`, newest activity first                                                                                   |
| `GET /counts`        | —                                                                                                          | `{ all, needsYou, drafted, unread }`, ignoring `q`                                                                                                                      |
| `GET /events`        | —                                                                                                          | SSE, below                                                                                                                                                              |
| `GET /:id`           | —                                                                                                          | `ConversationDetail`                                                                                                                                                    |
| `GET /:id/messages`  | `before`, `limit` 1–100 (default 50)                                                                       | `{ data: Message[], pagination: { prevCursor } }`: the newest page, oldest first; pass `prevCursor` as `before` for the page before it, null at the start of the thread |
| `PUT /:id/read`      | —                                                                                                          | 204. Reads up to the customer's last message; idempotent, and publishes only when something was unread                                                                  |
| `PATCH /:id`         | `{ botPaused }`, strict (any other key is 400)                                                             | 200 `ConversationDetail`. `true` takes over and never changes `state`; `false` hands back, below                                                                        |
| `POST /:id/messages` | `{ text }`, trimmed, 1–2000                                                                                | 201 `Message` (`sender: seller`, `status: sent`); errors below                                                                                                          |

Shapes are the Zod schemas in
[`packages/shared/src/schemas/conversation.ts`](../../../packages/shared/src/schemas/conversation.ts):

- `ConversationListItem`: `{ id, customer: { id, name | null }, state, botPaused, unread, lastMessage: { preview, sender, at }, lastInboundAt | null }`.
  `preview` is the last message on one line, at most 140 graphemes with a
  trailing `…`.
- `ConversationDetail`: the same without `lastMessage`, plus
  `replyWindowClosesAt` (`lastInboundAt` + 24 h, null if the customer never
  wrote; it stays set after the window closes, so compare it with the clock).
- `Message`: `{ id, sender (customer | assistant | seller), text, status (sending | sent | failed), sentAt }`.
  A dashboard reply and an inbox reply are both `seller`.

**Filters.** `needs_you` is `state = handed_off`; `drafted` is
`state = awaiting_confirmation`; `unread` is `last_inbound_at > seller_last_read_at`
(or never read). Only a customer message makes a thread unread. `botPaused` is
part of no filter. Marking read copies `last_inbound_at` into
`seller_last_read_at` rather than stamping the clock, so a message still in the
queue when the seller looked, or stamped ahead of the API's clock by Meta,
still arrives unread.

**Seller reply errors,** in the order they are checked. Everything after the
503 runs in one transaction with the conversation row locked.

| Status | Code                           | When                                                        |
| ------ | ------------------------------ | ----------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`            | blank or over-long `text`, bad id                           |
| 503    | `MESSENGER_NOT_CONFIGURED`     | the Messenger app is not configured                         |
| 404    | `CONVERSATION_NOT_FOUND`       |                                                             |
| 409    | `MESSENGER_WINDOW_CLOSED`      | `params.closedAt` (ISO), absent if the customer never wrote |
| 409    | `MESSENGER_PAGE_NOT_CONNECTED` | the conversation's Page is not the shop's connected Page    |
| 502    | `MESSENGER_SEND_FAILED`        | Graph refused, timed out (10 s) or returned no message id   |

**A reply in three steps,** so no transaction spans the Graph call: store it as
`sending`, move `last_*` and set `bot_paused`, commit; `POST /me/messages`
(`messaging_type: RESPONSE`); mark it `sent` with its Meta id, or `failed`, and
publish. A failed reply stays in the thread and as the list preview, and the
assistant stays paused; the seller retypes to retry.

## SSE (`GET /events`)

| Event                  | Data                 |                                                            |
| ---------------------- | -------------------- | ---------------------------------------------------------- |
| `ready`                | `{}`                 | first, with `retry: 5000`                                  |
| `conversation.updated` | `{ conversationId }` | one per change; no message text, no kind                   |
| `ping`                 | `{}`                 | every 25 s, so proxies never cut the stream for being idle |
| `evicted`              | `{}`                 | the last event of a stream closed over the cap, below      |

- No event ids and no `Last-Event-ID` replay: refetch the list, counts and open
  thread on every `ready`.
- Ends at the session's `expiresAt` as read when the stream opened (a sliding
  refresh does not extend it); the browser reconnects after 5 s and is
  authenticated again. Also ends on API shutdown, and when the API cannot
  subscribe to Redis: the reconnect retries the subscription.
- At most 5 open streams per shop **per API process**; a sixth ends the oldest
  with `evicted` (`CONVERSATION_STREAM_EVICTED_EVENT` in `@app/shared`). On
  `evicted` the client must close its `EventSource` rather than let it
  reconnect, or tabs evict each other in a loop. Any other close is safe to
  reconnect from.
- `@SkipThrottle()`, so the global rate limit does not count reconnects. An
  unauthenticated request gets the usual 401 envelope, which `EventSource`
  treats as fatal.
- Caddy leaves `/api/v1/conversations/events` out of `encode`.

## Rules

- **Two different "the assistant is off" facts.** `bot_paused` is the seller's
  takeover (Take over, a dashboard reply, or a reply from Facebook's own inbox).
  `state = handed_off` is the assistant giving up, and is what "Needs you" shows.
  Handing back clears the first and, if the conversation was `handed_off`,
  resumes it at `collecting_details` when any detail was collected, otherwise
  `browsing`. The assistant resumes only on Hand back.
- **24-hour window.** A reply is allowed while
  `now − last_inbound_at < 24 h` (API clock), and refused with
  `409 MESSENGER_WINDOW_CLOSED` from then on; no `HUMAN_AGENT` tag.
  `last_inbound_at` is Meta's timestamp of the customer's last message and only
  moves forward. A thread started by a seller echo has none, so it cannot be
  replied to until the customer writes. Enforced on send only.
- **Pages.** Conversations key on Facebook's Page id, not the `facebook_page`
  row, so disconnecting and reconnecting the same Page keeps its threads.
  Replying needs the conversation's Page to be the one connected now
  (`409 MESSENGER_PAGE_NOT_CONNECTED`).
- **Search** is a case-insensitive substring (`ILIKE '%q%'`) on `customer.name`
  or on any message in the thread, not only the last one, so the preview may
  not show the match. `%`, `_` and `\` are matched literally. It combines with
  `filter` and the cursor. `pg_trgm` GIN indexes serve terms of 3 or more
  characters. `q` is masked in request logs (`common/redact-url.ts`).
- **Pagination** is a keyset cursor on `(last_message_at DESC, id DESC)`
  (messages: `(sent_at, id)`), not offsets: the list re-sorts whenever a message
  arrives. Cursors are opaque; one this API did not issue is
  `400 VALIDATION_FAILED` on `fields.cursor` (or `fields.before`).

## Data model

Schema in
[`customers.ts`](../../../apps/api/src/modules/database/schema/customers.ts) and
[`conversations.ts`](../../../apps/api/src/modules/database/schema/conversations.ts).
All three tables have RLS enabled and forced with a `*_merchant_isolation`
policy, and composite `(merchant_id, id)` foreign keys, so a row cannot point
into another shop.

- `customer`: `psid`, `name` (null until Facebook shares one),
  `profile_fetched_at`. `UNIQUE (merchant_id, psid)`; trigram index on `name`.
  Contact details and notes: [05 · Customers](../05-customers/README.md).
- `conversation`: `facebook_page_id` (text, deliberately not a foreign key),
  `customer_id`, `state` (default `browsing`), `collected_slots` (jsonb),
  `bot_paused`, `last_message_at`, `last_message_preview`,
  `last_message_sender`, `last_inbound_at`, `seller_last_read_at`.
  `UNIQUE (merchant_id, facebook_page_id, customer_id)`; indexes on the list
  order and partial ones for `handed_off` and `awaiting_confirmation`.
- `message`: `sender`, `text`, `meta_message_id` (null while `sending`),
  `status`, `sent_at`. `UNIQUE (merchant_id, meta_message_id)`; cascades with
  its conversation; trigram index on `text`. Nothing writes `assistant` yet.

**The Page resolver.** The worker must find a Page's merchant before any
merchant context exists. `app_page_merchant(text)` returns that merchant id, or
NULL for a Page no shop has connected. It is `SECURITY DEFINER` with a pinned
`search_path`, `EXECUTE` revoked from `PUBLIC` and granted to `app_runtime`,
and owned by the `NOLOGIN` role `app_page_resolver`, which may only `SELECT`
`page_id` and `merchant_id` from `facebook_page` (policy
`facebook_page_resolver_read`). The migrating role must be a superuser or hold
`SET` membership in `app_page_resolver`. Call it through `resolvePageMerchant()`.

## Follow-ups

- Queue the assistant's turn from `InboundMessageIngest` (AI work), honouring
  the conversation's `bot_paused` and the Page's `bot_enabled`.
- Drafted-order panel and customer order history; settle the design's seller
  "Confirm order" against the rule that only the customer confirms.
- Per-shop auto-resume after a takeover (Never / 1 h / 24 h) in Settings ›
  Assistant, once the settings API exists.
- The Conversations web route, using the SSE contract above.
- `HUMAN_AGENT` tag after App Review, if pilots ask for it.
- `WORKER_CONCURRENCY` is not yet applied to the inbound processor (BullMQ's
  default of 1 is used).
- The Caddyfile change (`@compressible not path …`) has not been run through
  `caddy validate`; validate before deploying.
- A reply can stay `sending` if the process dies mid-send or the final write
  fails; the web client should treat a `sending` message older than about 30 s
  as failed, and a sweep can mark them later.
- A send that times out may still have been delivered; it is recorded as
  failed (its echo carries our app id and is skipped), so retyping it can send
  it twice.
- A failed reply still pauses the assistant and becomes the list preview;
  decide whether a failure should undo the pause.
- If an echo of our own reply arrives without our `app_id` before the reply is
  marked `sent`, the ingest stores it first and `markSent` hits
  `UNIQUE (merchant_id, meta_message_id)`: a 500 and a doubled message.
- An SSE stream is closed at session expiry, not on sign-out elsewhere or
  revocation; it exposes conversation ids only in the meantime.
- Events are lost while the API's Redis subscriber is reconnecting, and when a
  publish fails (logged and swallowed).
- Check `bull:messenger-inbound:wait` in production before the first deploy of
  this branch: jobs queued before messages carried a `kind` are now read as
  customer messages, but confirm what is waiting.
