# 04 · Conversations

How Messenger conversations reach the seller's dashboard. Scope comes from the
MVP's [scope](../../mvp/01-messenger-to-order/scope.md) ("conversation viewer",
"human handoff, and bot auto-pause when the seller replies manually").

**Status (Oct 2026):** the worker stores customer messages and seller echoes.
The API lists, searches, counts and shows conversations, marks them read,
takes over and hands back, sends and deletes failed seller replies, and
streams changes over SSE. The inbox is at `/conversations` and
`/conversations/:id`.

The assistant replies
([phase 11.1](../11-ai-implementation/phase-1-foundation/README.md)) with quick
replies, product photos, and a summary card whose Confirm button creates the
order ([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md)).
A tap comes back as a customer message carrying its payload. The customer's
details and the chat's latest order sit beside the thread, where the seller
can confirm a drafted order. Not built: the customer's order list beside the
thread ([Follow-ups](#follow-ups)).

[Message flow](message-flow.md) draws a customer message and a seller reply as
sequence diagrams.

## Webhook

[`messenger.controller.ts`](../../../apps/api/src/modules/messenger/messenger.controller.ts)
serves `/api/v1/webhooks/messenger` with `@AllowAnonymous()`; the verify token
and the signature are Meta's authentication.

- **`GET`** is the subscription handshake. With `hub.mode=subscribe` and
  `hub.verify_token` equal to `META_VERIFY_TOKEN`, it returns `hub.challenge`
  as plain text; anything else is `401 WEBHOOK_VERIFICATION_FAILED`. The
  global throttle applies.
- **`POST`** checks, in order:

  | Status | Code                        | When                                                                                                              |
  | ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | 400    | `WEBHOOK_MISSING_RAW_BODY`  | the request has no raw body                                                                                       |
  | 401    | `WEBHOOK_INVALID_SIGNATURE` | `X-Hub-Signature-256` is not `sha256=<hex>` of the raw body, keyed with `META_APP_SECRET` (constant-time compare) |
  | 400    | `WEBHOOK_MALFORMED_PAYLOAD` | the body is not a JSON object                                                                                     |

  It then queues one job per text message or button tap and answers
  `200 EVENT_RECEIVED` at once. The job id is the Meta message id (`mid`),
  with `%` and `:` escaped by `customJobId`. A body whose `object` is not
  `page` queues nothing and still gets `200`.

- **`POST` skips the throttle** (`@SkipThrottle()`): Meta sends every Page's
  events from a few addresses, so a per-IP limit would throttle all shops at
  once.
- The raw body survives because the auth module's body parser sets
  `rawBody: true` ([Auth](../01-auth/README.md#http-endpoints)).

| Variable             | Notes                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `META_VERIFY_TOKEN`  | Required. The token typed into the Meta app's webhook setup.                                                 |
| `META_APP_SECRET`    | Required. The signature key ([Page connection](../03-facebook-page/README.md#configuration)).                |
| `META_APP_ID`        | Optional. The ingest skips an echo carrying it. Without it, nothing is skipped and no assistant turn queues. |
| `WORKER_CONCURRENCY` | Defaults to 5. Nothing reads it yet ([Follow-ups](#follow-ups)).                                             |

## Ingest

`InboundMessageProcessor`, in the worker only, hands each `messenger-inbound`
job to `InboundMessageIngest`. A job is a `customer-message`,
`customer-postback` or `page-echo`; for an echo, the customer is the
recipient. [Message flow](message-flow.md#a-customer-message) draws the steps.

- **Text and taps only.** An event without `message.text` (attachments,
  stickers, reactions, deliveries) makes no job, so an image-only first
  message creates no customer or conversation.
- **Taps.** A quick-reply tap is a text message with
  `message.quick_reply.payload`. A button tap is a `postback`, stored as a
  customer message whose text is the button title. Both keep the payload in
  `message.payload`. A postback without a payload makes no job. For a
  postback without a `mid`, the webhook derives one from the sender,
  timestamp and payload, so a redelivery stays a no-op.
- **The Page resolver.** `resolvePageMerchant()` finds the Page's merchant. A
  Page no shop has connected is dropped with a warning (`unknown-page`).
- **Transactions.** One short transaction reads the customer and the Page; the
  profile fetch, if due, runs outside any transaction. One `withMerchant`
  transaction then upserts the customer, locks or creates the conversation,
  inserts the message and moves the `last_*` columns. After commit it
  publishes `{ merchantId, conversationId, kind }` on the Redis channel
  `conversation-events`.
- **Seller echoes.** An echo whose `app_id` is not `META_APP_ID` came from
  Facebook's inbox or another app; it is stored as `sender = seller` and sets
  `bot_paused`. Our own sends are written by their sender, so an echo with our
  app id is skipped (`own-echo`).
- **The next order.** A customer message on a `confirmed` chat, other than a
  Confirm or Change tap on a summary card, moves it back to `browsing` in the
  same transaction, whether or not the assistant is on. `slotsForNextOrder`
  clears the items, quote, offered quick replies and ask counter, keeps the
  name, phone, address, area and delivery charge, and bumps `revision`, so
  every earlier card goes stale and the next card gets a new idempotency key.
- **The assistant's turn.** After a stored customer message, the ingest queues
  an `assistant-turn` job when the Page's `bot_enabled` is on, `LLM_API_KEY`
  and `META_APP_ID` are set, the chat is not `bot_paused`, and its state is
  not `handed_off`. On a `confirmed` chat only a Confirm tap queues a turn, so
  a second tap gets the order's reference again. A typed message waits 2.5 s,
  so a burst gets one answer; a postback queues with no delay.
- **Dedupe, two layers.** `jobId = mid` drops a repeat while BullMQ keeps the
  completed job (1 h, or the last 1000). `UNIQUE (merchant_id,
meta_message_id)` with `ON CONFLICT DO NOTHING` is the backstop, and a
  duplicate publishes nothing.
- **Failures.** An unknown job name or malformed payload fails once with
  `UnrecoverableError`, logging field paths, never values. Other errors retry
  with the queue defaults: 5 attempts, exponential backoff from 1 s.
- **Customer profile.** `GET /{psid}?fields=name,profile_pic` with the Page's
  token, outside any transaction. `needsProfile` asks for a new customer,
  again 24 h after the last try while the name or picture is missing, and
  every 3 days once both are known, because Facebook's picture link expires.
  A read keeps any field Facebook did not return, and a Graph failure does not
  stop the message from being stored.
- **Daily profile refresh.** `ProfileRefreshProcessor`, in the worker only,
  runs at 04:00 in the worker's time zone (UTC in the containers), an hour
  after the image sweep, through the scheduler `refresh-stale-profiles-daily`
  (`0 4 * * *`), upserted on each boot. Per shop it re-reads up to 200
  customers whose profile is due and who had a conversation in the last 30
  days, each Graph call outside a transaction. After 5 failures in a row it
  stops for that shop, since the Page token is likely revoked. The dashboard
  shows initials without a picture.

## Routes (`/api/v1/conversations`, session + TenantGuard)

A non-UUID `:id` or `:messageId` is `400 VALIDATION_FAILED`. An unknown id or
another shop's is `404 CONVERSATION_NOT_FOUND`.

| Route                             | Request                                                                                                    | Response                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                           | `filter` (`all` default, `needs_you`, `drafted`, `unread`), `q` ≤ 100, `cursor`, `limit` 1–50 (default 25) | `{ data: ConversationListItem[], pagination: { nextCursor } }`, newest activity first. A blank `q` means no search.                                                                                       |
| `GET /counts`                     | none                                                                                                       | `{ all, needsYou, drafted, unread }`, ignoring `q`.                                                                                                                                                       |
| `GET /events`                     | none                                                                                                       | SSE, [below](#sse-get-events).                                                                                                                                                                            |
| `GET /:id`                        | none                                                                                                       | `ConversationDetail`                                                                                                                                                                                      |
| `GET /:id/messages`               | `before`, `limit` 1–100 (default 50)                                                                       | `{ data: Message[], pagination: { prevCursor } }`: the newest page, oldest first. Pass `prevCursor` as `before` for older messages; it is null at the start.                                              |
| `PUT /:id/read`                   | none                                                                                                       | 204. Marks the thread read up to the customer's last message. Idempotent; publishes only if something was unread.                                                                                         |
| `PATCH /:id`                      | `{ botPaused }`, strict                                                                                    | 200 `ConversationDetail`. `true` takes over without changing `state`; `false` hands back ([Rules](#rules)).                                                                                               |
| `POST /:id/messages`              | `{ text }`, trimmed, 1–2000 characters                                                                     | 201 `Message` with `sender: seller` and `status: sent`. Errors below.                                                                                                                                     |
| `DELETE /:id/messages/:messageId` | none                                                                                                       | 204. Deletes only a seller reply with `status: failed`; any other message is `409 MESSAGE_NOT_DELETABLE`, an unknown one `404 MESSAGE_NOT_FOUND`. The list preview falls back to the newest message left. |

Shapes, in
[`packages/shared/src/schemas/conversation.ts`](../../../packages/shared/src/schemas/conversation.ts):

- `ConversationListItem`: `{ id, customer: { id, name | null, pictureUrl | null }, state, botPaused, unread, lastMessage: { preview, sender, at }, lastInboundAt | null }`.
  `preview` is the last message on one line, at most 140 graphemes, ending in
  `…` when cut.
- `ConversationDetail`: the same without `lastMessage`, plus
  `replyWindowClosesAt` (`lastInboundAt` + 24 h, or null if the customer never
  wrote; it stays set after closing, so compare it with the clock) and
  `latestOrderId` (the chat's most recent order of any status, or null).
- `Message`: `{ id, sender (customer | assistant | seller), text, status (sending | sent | failed), sentAt }`.
  Replies from the dashboard and from Facebook's inbox are both `seller`.

**Filters.** `needs_you` is `state = handed_off`, `drafted` is
`state = awaiting_confirmation`, and `unread` is `last_inbound_at >
seller_last_read_at` or never read. Only a customer message makes a thread
unread, and no filter looks at `botPaused`. Marking read copies
`last_inbound_at` into `seller_last_read_at` rather than the current time, so
a message still queued when the seller looked, or stamped ahead of the API's
clock, still arrives unread.

**Seller reply errors,** in check order. The 404 and both 409s are checked in
one transaction with the conversation row locked; the 502 comes after it
commits.

| Status | Code                           | When                                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`            | `text` is blank or too long, or the id is not a UUID                                        |
| 503    | `MESSENGER_NOT_CONFIGURED`     | `META_APP_ID` is not set                                                                    |
| 404    | `CONVERSATION_NOT_FOUND`       | the conversation is not this shop's                                                         |
| 409    | `MESSENGER_WINDOW_CLOSED`      | the 24-hour window is closed. `params.closedAt` (ISO) is absent if the customer never wrote |
| 409    | `MESSENGER_PAGE_NOT_CONNECTED` | the conversation's Page is not the shop's connected Page                                    |
| 502    | `MESSENGER_SEND_FAILED`        | Graph refused the message, timed out (10 s), or returned no message id                      |

**A reply takes three steps,** so no transaction is open during the Graph call:

1. Store the reply as `sending`, move the `last_*` columns, set `bot_paused`,
   and commit.
2. Call `POST /me/messages` with `messaging_type: RESPONSE`.
3. Mark the reply `sent` with its Meta message id, or `failed`, and publish.

A failed reply stays in the thread and as the preview, and the assistant
stays paused. The seller can retry (the same text as a new reply) or remove
it.

## SSE (`GET /events`)

| Event                  | Data                 | When                                                  |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| `ready`                | `{}`                 | First, with `retry: 5000`.                            |
| `conversation.updated` | `{ conversationId }` | One per change, with no message text and no `kind`.   |
| `ping`                 | `{}`                 | Every 25 s, so proxies do not cut an idle stream.     |
| `evicted`              | `{}`                 | The last event of a stream closed over the cap below. |

- No event ids and no `Last-Event-ID` replay: refetch the list, the counts and
  the open thread on every `ready`.
- The stream ends at the session's `expiresAt` as read when it opened (a
  sliding refresh does not extend it), on API shutdown, and when the API
  cannot subscribe to Redis. The browser reconnects after 5 s and
  authenticates again.
- Each API process keeps at most 5 streams per shop; a sixth ends the oldest
  with `evicted` (`CONVERSATION_STREAM_EVICTED_EVENT` in `@app/shared`). On
  `evicted` the client must close its `EventSource` rather than reconnect, or
  tabs evict each other in a loop.
- `@SkipThrottle()` keeps reconnects out of the rate limit. An unauthenticated
  request gets the 401 envelope, which `EventSource` treats as fatal.
- The `Caddyfile` leaves `/api/v1/conversations/events` out of `encode`,
  since compression would hold events back.

## Rules

- **Two facts turn the assistant off.** `bot_paused` is the seller's takeover
  (Take over, a dashboard reply, or a reply from Facebook's inbox).
  `state = handed_off` is the assistant giving up, shown as "Needs you".
- **Hand back.** `PATCH /:id` with `botPaused: false` clears `bot_paused` and
  the ask counter. A `handed_off` chat resumes at `collecting_details` if any
  detail was collected, else `browsing`, and `handed_off_at` is cleared. A
  paused chat in `awaiting_confirmation` goes back to `collecting_details` and
  its summary card is retired (`revision` + 1, quote cleared). The assistant
  resumes only on Hand back.
- **24-hour window.** A reply is allowed while
  `now − last_inbound_at < 24 h` by the API's clock, then refused with
  `409 MESSENGER_WINDOW_CLOSED`; no `HUMAN_AGENT` tag is sent.
  `last_inbound_at` is Meta's timestamp of the customer's last message and
  only moves forward. A thread started by a seller echo has none, so the
  seller cannot reply until the customer writes. Only the send route enforces
  the window.
- **Pages.** Conversations key on Facebook's Page id, not the `facebook_page`
  row, so reconnecting the same Page keeps its threads. A reply needs the
  conversation's Page to be the one connected now.
- **Search** is a case-insensitive substring match (`ILIKE '%q%'`) on
  `customer.name` or any message in the thread, so the preview may not show
  the match. `%`, `_` and `\` match literally. It combines with `filter` and
  the cursor. `pg_trgm` GIN indexes serve terms of 3 or more characters.
  Request logs mask `q` (`common/redact-url.ts`).
- **Pagination** is a keyset cursor on `(last_message_at DESC, id DESC)`, and
  `(sent_at, id)` for messages, because the list re-sorts on every message
  and offsets would skip or repeat rows. A cursor this API did not issue is
  `400 VALIDATION_FAILED` on `fields.cursor` or `fields.before`.

## Data model

[`customers.ts`](../../../apps/api/src/modules/database/schema/customers.ts)
and
[`conversations.ts`](../../../apps/api/src/modules/database/schema/conversations.ts).
All three tables have RLS enabled and forced with a `*_merchant_isolation`
policy. `conversation` references `customer`, and `message` references
`conversation`, through composite `(merchant_id, id)` foreign keys.

- `customer`: `psid`, `name` and `picture_url` (null until Facebook shares
  them), `profile_fetched_at`. `UNIQUE (merchant_id, psid)` and a trigram
  index on `name`. Contact details and notes are in
  [05 · Customers](../05-customers/README.md).
- `conversation`: `facebook_page_id` (text, deliberately not a foreign key),
  `customer_id`, `state` (default `browsing`), `collected_slots` (jsonb),
  `bot_paused`, `handed_off_at` (set exactly while `state = handed_off`,
  migration `0030`), `last_message_at`, `last_message_preview`,
  `last_message_sender`, `last_inbound_at`, `seller_last_read_at`.
  `UNIQUE (merchant_id, facebook_page_id, customer_id)`, an index on the list
  order, and partial indexes for `handed_off` and `awaiting_confirmation`.
- `message`: `sender`, `text`, `meta_message_id` (null while `sending`),
  `payload` (a tap's payload, migration `0033`), `status`, `sent_at`, and
  `updated_at` (a reply's last claim to be sent, which the Confirm redelivery
  leases, migration `0034`). `UNIQUE (merchant_id, meta_message_id)`, deleted
  with its conversation, and a trigram index on `text`. The assistant writes
  `assistant` rows through `OutboundMessageSender`.

**The Page resolver.** The worker must find a Page's merchant before any
merchant context exists. `app_page_merchant(text)` returns it, or NULL for an
unconnected Page. It is `SECURITY DEFINER` with a pinned `search_path`,
`EXECUTE` revoked from `PUBLIC` and granted to `app_runtime`, and owned by the
`NOLOGIN` role `app_page_resolver`, which may only `SELECT` `page_id` and
`merchant_id` from `facebook_page` (policy `facebook_page_resolver_read`). The
migrating role must be a superuser or hold `SET` membership in
`app_page_resolver`. Migrations `0009` and `0011` create both. Call it through
`resolvePageMerchant()`.

## Web

- **`/conversations`** lists threads with the filter tabs, counts and search;
  **`/conversations/:id`** opens one beside the list, with who it is with, who
  is answering (Take over or Hand back), the messages and the reply box.
  Nothing polls: one `EventSource` on `GET /events` invalidates what a change
  touches, and keeps the sidebar badge live on every page.
- **Eager replies.** Enter sends and clears the box at once, showing a local
  copy until the API answers. A chat's replies go out one at a time, in order,
  through one mutation scope. A failed reply shows Retry and Remove. The box
  is closed outside the 24-hour window.
- **Beside the thread,** from `xl` up, a panel shows the customer (name,
  phone, address, order count, total spent, from `GET /customers/:id`) and the
  chat's latest order (`GET /orders/:id`: lines, delivery, total, payment
  method). A drafted (`new`) order offers Confirm order, the seller's second
  confirmation, and Edit order; a later one offers View order. The route
  composes `ChatCustomerDetails` and `ChatOrderSummary`, so the conversations
  feature imports neither.
- **Below `xl`,** the same sections are their own screen,
  **`/conversations/:id/details`**, opened from the person icon in the chat
  header, with a back link and breadcrumb. While the order is drafted,
  `ChatOrderBanner` above the reply box ("Order drafted · ৳3,260") opens it.
- **Days** split at the shop's midnight
  ([Settings – General](../06-settings-general/README.md#dashboard)).
- Code: `apps/web/src/features/conversations/` and
  `apps/web/src/routes/_app/conversations/`.

## Follow-ups

- Show the customer's order list beside the thread; today only the latest
  order shows.
- Per-shop auto-resume after a takeover (Never, 1 h, 24 h) in
  Settings › Assistant, which needs its own settings and a resume job.
- The `HUMAN_AGENT` tag after App Review, if pilots ask.
- Apply `WORKER_CONCURRENCY` or remove it. The inbound processor runs at
  BullMQ's default of 1.
- Mark an abandoned `sending` reply `failed`. A reply stays `sending` if the
  process dies mid-send or the final write fails, and nothing sweeps it.
- Decide whether a failed reply should undo the pause; today it does not.
- A send that times out may still have been delivered. It is recorded
  `failed`, and its echo carries our app id and is skipped, so a retry can
  send it twice.
- If an echo of our reply arrives without our `app_id` before the reply is
  marked `sent`, the ingest stores it first, and `markSent` then hits
  `UNIQUE (merchant_id, meta_message_id)`: a 500 and a doubled message.
- An SSE stream closes at session expiry, not on sign-out elsewhere or
  revocation, and until then still exposes conversation ids.
- Events are lost while the Redis subscriber reconnects and when a publish
  fails; the publisher logs and swallows the failure.
- Before the first production deploy carrying the job `kind`, check
  `bull:messenger-inbound:wait`. The worker reads a job without `kind` as a
  customer message.

The assistant's own follow-ups are on the
[phase 11.1](../11-ai-implementation/phase-1-foundation/README.md#follow-ups)
and
[phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#follow-ups)
pages.
