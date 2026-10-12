# 04 · Conversations

How Messenger conversations reach the seller's dashboard. Scope comes from the
MVP's [scope](../../mvp/01-messenger-to-order/scope.md) ("conversation viewer",
"human handoff, and bot auto-pause when the seller replies manually"). This
page describes what is built.

**Status (Oct 2026):** the worker stores customer messages and seller echoes.
The API lists, searches, counts and shows conversations. It also marks them
read, takes over and hands back, sends seller replies, deletes failed replies,
and streams changes over SSE. The dashboard has the inbox at `/conversations`
and `/conversations/:id`.

The assistant sends replies
([phase 11.1](../11-ai-implementation/phase-1-foundation/README.md)) with quick
replies, product photos, and a summary card whose Confirm button creates the
order ([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md)).
A tap on any of them comes back as a customer message that carries the tap's
payload. The customer's details and the chat's latest order sit beside the
thread on wide screens, and on a separate Details screen below that. The seller
can confirm a drafted order from there.

Not built yet: the customer's order list beside the thread. See
[Follow-ups](#follow-ups).

[Message flow](message-flow.md) draws a customer message and a seller reply as
sequence diagrams.

## Webhook

[`messenger.controller.ts`](../../../apps/api/src/modules/messenger/messenger.controller.ts)
serves `/api/v1/webhooks/messenger` with `@AllowAnonymous()`. Meta carries no
session, so the verify token and the signature are its authentication.

- **`GET`** is Meta's subscription handshake. When `hub.mode=subscribe` and
  `hub.verify_token` equals `META_VERIFY_TOKEN`, it returns `hub.challenge` as
  plain text. Anything else is `401 WEBHOOK_VERIFICATION_FAILED`. The global
  throttle applies to it.
- **`POST`** checks the request before any work, in this order:

  | Status | Code                        | When                                                                                                              |
  | ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | 400    | `WEBHOOK_MISSING_RAW_BODY`  | the request has no raw body                                                                                       |
  | 401    | `WEBHOOK_INVALID_SIGNATURE` | `X-Hub-Signature-256` is not `sha256=<hex>` of the raw body, keyed with `META_APP_SECRET` (constant-time compare) |
  | 400    | `WEBHOOK_MALFORMED_PAYLOAD` | the body is not a JSON object                                                                                     |

  It then queues one job per text message or button tap and answers
  `200 EVENT_RECEIVED` at once. The job id is the Meta message id (`mid`),
  with `%` and `:` escaped by `customJobId`. A body whose `object` is not
  `page` queues nothing and still gets `200`.

- **`POST` skips the throttle** (`@SkipThrottle()`). Meta delivers every Page's
  events from a few addresses, so a per-IP limit would throttle all shops
  together.
- The raw body survives because the auth module sets `rawBody: true` on its
  body parser ([Auth](../01-auth/README.md#http-endpoints)).

| Variable             | Notes                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `META_VERIFY_TOKEN`  | Required. The token typed into the Meta app's webhook setup.                                                        |
| `META_APP_SECRET`    | Required. The signature key ([Page connection](../03-facebook-page/README.md#configuration)).                       |
| `META_APP_ID`        | Optional. The ingest skips an echo that carries it. Without it, nothing is skipped and no assistant turn is queued. |
| `WORKER_CONCURRENCY` | Defaults to 5. Nothing reads it yet (see [Follow-ups](#follow-ups)).                                                |

## Ingest

`InboundMessageProcessor` runs in the worker only and passes each
`messenger-inbound` job to `InboundMessageIngest`. A job has one of three
kinds: `customer-message`, `customer-postback`, or `page-echo`. For an echo,
the customer is the recipient. [Message flow](message-flow.md#a-customer-message)
draws the steps.

- **Text and taps only.** An event without `message.text` (attachments,
  stickers, reactions, deliveries) makes no job. An image-only first message
  therefore creates no customer or conversation.
- **Taps.** A quick-reply tap is a text message that carries
  `message.quick_reply.payload`. A button tap is a `postback` event, stored as
  a customer message whose text is the button's title. Both keep their payload
  in `message.payload`. A postback without a payload makes no job. Meta can
  send a postback without a `mid`. The webhook then derives one from the
  sender, the timestamp and the payload, so a redelivery stays a no-op.
- **The Page resolver.** The ingest finds the Page's merchant with
  `resolvePageMerchant()`. A Page no shop has connected is dropped with a
  warning, and the outcome is `unknown-page`.
- **One transaction.** The ingest reads the customer and the Page in one short
  transaction. It fetches the profile, if one is due, outside any transaction.
  One `withMerchant` transaction then upserts the customer, locks or creates
  the conversation, inserts the message, and moves the `last_*` columns
  forward. After commit, it publishes `{ merchantId, conversationId, kind }` on
  the Redis channel `conversation-events`.
- **Seller echoes.** An echo whose `app_id` is not `META_APP_ID` comes from
  Facebook's own inbox or another app on the Page. The ingest stores it as
  `sender = seller` and sets `bot_paused`. Our own sends are written by the
  code that sent them, so the ingest skips an echo that carries our app id
  (`own-echo`).
- **The next order.** A customer message on a `confirmed` chat moves it back to
  `browsing` in the ingest's transaction, whether or not the assistant is on.
  A Confirm or Change tap on a summary card is the exception. The move resets
  the slots with `slotsForNextOrder`. It clears the items, the quote, the
  offered quick replies, and the ask counter. It keeps the name, phone,
  address, area and delivery charge for the next card, and bumps `revision`.
  Every earlier card then goes stale, and the next card never reuses the
  confirmed card's idempotency key.
- **The assistant's turn.** After a stored customer message, the ingest queues
  an `assistant-turn` job when all of these hold: the Page's `bot_enabled` is
  on, `LLM_API_KEY` and `META_APP_ID` are set, the chat is not `bot_paused`,
  and its state is not `handed_off`. On a `confirmed` chat, only a Confirm tap
  queues a turn, so a second tap gets the order's reference again. A typed
  message waits 2.5 s, so a burst gets one answer. A postback is queued with
  no delay.
- **Dedupe, two layers.** `jobId = mid` drops a repeat while BullMQ keeps the
  completed job (1 h, or the last 1000 jobs). `UNIQUE (merchant_id,
meta_message_id)` with `ON CONFLICT DO NOTHING` is the backstop. A duplicate
  publishes nothing.
- **Failures.** An unknown job name or a malformed payload fails once with
  `UnrecoverableError`. The log names the field paths, never the values. Any
  other error retries with the queue defaults: 5 attempts, exponential backoff
  from 1 s.
- **Customer profile.** The ingest calls `GET /{psid}?fields=name,profile_pic`
  with the connected Page's token, outside any transaction. `needsProfile`
  decides when. It asks for a new customer, and again 24 h after the last try
  while the name or the picture is missing. Once both are known, it asks every
  3 days, because Facebook's picture link expires. A read keeps any name or
  picture that Facebook did not return. A Graph failure does not stop the
  message from being stored.
- **Daily profile refresh.** `ProfileRefreshProcessor` runs in the worker only,
  daily at 04:00 through the BullMQ job scheduler `refresh-stale-profiles-daily`
  (cron `0 4 * * *`). The pattern sets no time zone, so it runs in the
  worker's, which is UTC in the containers. That is an hour after the image
  sweep. Every worker boot upserts the scheduler. For each shop, the run
  re-reads up to 200 customers whose profile is due and who had a conversation
  in the last 30 days. Each Graph call runs outside any transaction. After 5
  failures in a row, the run stops for that shop, because its Page token is
  likely revoked. The dashboard shows initials when a customer has no picture.

## Routes (`/api/v1/conversations`, session + TenantGuard)

A non-UUID `:id` or `:messageId` is `400 VALIDATION_FAILED`. An unknown id, or
another shop's, is `404 CONVERSATION_NOT_FOUND`, never `403`.

| Route                             | Request                                                                                                    | Response                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                           | `filter` (`all` default, `needs_you`, `drafted`, `unread`), `q` ≤ 100, `cursor`, `limit` 1–50 (default 25) | `{ data: ConversationListItem[], pagination: { nextCursor } }`, newest activity first. A blank `q` means no search.                                                                                                                                |
| `GET /counts`                     | —                                                                                                          | `{ all, needsYou, drafted, unread }`. Ignores `q`.                                                                                                                                                                                                 |
| `GET /events`                     | —                                                                                                          | SSE, described below.                                                                                                                                                                                                                              |
| `GET /:id`                        | —                                                                                                          | `ConversationDetail`                                                                                                                                                                                                                               |
| `GET /:id/messages`               | `before`, `limit` 1–100 (default 50)                                                                       | `{ data: Message[], pagination: { prevCursor } }`. The newest page, oldest first. Pass `prevCursor` as `before` for the page before it. `prevCursor` is null at the start of the thread.                                                           |
| `PUT /:id/read`                   | —                                                                                                          | 204. Marks the thread read up to the customer's last message. Idempotent. Publishes only when something was unread.                                                                                                                                |
| `PATCH /:id`                      | `{ botPaused }`, strict (any other key is 400)                                                             | 200 `ConversationDetail`. `true` takes over and never changes `state`. `false` hands back, as described in [Rules](#rules).                                                                                                                        |
| `POST /:id/messages`              | `{ text }`, trimmed, 1–2000 characters                                                                     | 201 `Message` with `sender: seller` and `status: sent`. Errors are listed below.                                                                                                                                                                   |
| `DELETE /:id/messages/:messageId` | —                                                                                                          | 204. Deletes only a seller reply with `status: failed`, which never reached the customer. Any other message is `409 MESSAGE_NOT_DELETABLE`, and an unknown one is `404 MESSAGE_NOT_FOUND`. The list preview falls back to the newest message left. |

The shapes are the Zod schemas in
[`packages/shared/src/schemas/conversation.ts`](../../../packages/shared/src/schemas/conversation.ts):

- `ConversationListItem` is `{ id, customer: { id, name | null, pictureUrl | null }, state, botPaused, unread, lastMessage: { preview, sender, at }, lastInboundAt | null }`.
  `preview` is the last message on one line, at most 140 graphemes, ending in
  `…` when cut.
- `ConversationDetail` is the same without `lastMessage`, plus two fields.
  `replyWindowClosesAt` is `lastInboundAt` + 24 h, or null if the customer
  never wrote. It stays set after the window closes, so compare it with the
  clock. `latestOrderId` is the order placed from this chat most recently,
  whatever its status, or null. `PATCH /:id` returns this shape too.
- `Message` is `{ id, sender (customer | assistant | seller), text, status (sending | sent | failed), sentAt }`.
  A reply from the dashboard and a reply from Facebook's inbox are both
  `seller`.

**Filters.** `needs_you` is `state = handed_off`. `drafted` is
`state = awaiting_confirmation`. `unread` is `last_inbound_at >
seller_last_read_at`, or a thread the seller never read. Only a customer
message makes a thread unread. No filter looks at `botPaused`. Marking a
thread read copies `last_inbound_at` into `seller_last_read_at` instead of the
current time. A message still in the queue when the seller looked, or one Meta
stamped ahead of the API's clock, therefore still arrives unread.

**Seller reply errors,** in the order the API checks them. The 404 and both
409s are checked in one transaction, with the conversation row locked. The 502
comes after that transaction commits.

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

A failed reply stays in the thread and as the list preview, and the assistant
stays paused. The seller can retry it, which sends the same text as a new
reply, or remove it with `DELETE /:id/messages/:messageId`.

## SSE (`GET /events`)

| Event                  | Data                 | When                                                        |
| ---------------------- | -------------------- | ----------------------------------------------------------- |
| `ready`                | `{}`                 | First, with `retry: 5000`.                                  |
| `conversation.updated` | `{ conversationId }` | One per change. Carries no message text and no `kind`.      |
| `ping`                 | `{}`                 | Every 25 s, so proxies never cut the stream for being idle. |
| `evicted`              | `{}`                 | The last event of a stream closed over the cap, below.      |

- The stream has no event ids and no `Last-Event-ID` replay. Refetch the list,
  the counts and the open thread on every `ready`.
- The stream ends at the session's `expiresAt`, as read when the stream
  opened. A sliding refresh does not extend it. The browser reconnects after
  5 s and authenticates again. The stream also ends on API shutdown, and when
  the API cannot subscribe to Redis. The reconnect then retries the
  subscription.
- Each API process keeps at most 5 open streams per shop. A sixth ends the
  oldest with `evicted` (`CONVERSATION_STREAM_EVICTED_EVENT` in `@app/shared`).
  On `evicted`, the client must close its `EventSource` instead of letting it
  reconnect. Otherwise tabs evict each other in a loop. Any other close is safe
  to reconnect from.
- The route has `@SkipThrottle()`, so the global rate limit does not count
  reconnects. An unauthenticated request gets the usual 401 envelope, which
  `EventSource` treats as fatal.
- The `Caddyfile` leaves `/api/v1/conversations/events` out of `encode`,
  because compression would hold events back until a buffer fills.

## Rules

- **Two different facts turn the assistant off.** `bot_paused` is the seller's
  takeover: Take over, a dashboard reply, or a reply from Facebook's own inbox.
  `state = handed_off` is the assistant giving up, and is what "Needs you"
  shows.
- **Hand back.** `PATCH /:id` with `botPaused: false` clears `bot_paused` and
  resets the ask counter. If the conversation was `handed_off`, it resumes at
  `collecting_details` when any detail was collected, otherwise at `browsing`,
  and `handed_off_at` is cleared. A paused conversation in
  `awaiting_confirmation` goes back to `collecting_details`, and its summary
  card is retired: `revision` goes up by one and the quote is cleared. The
  assistant resumes only on Hand back.
- **24-hour window.** The API allows a reply while
  `now − last_inbound_at < 24 h`, by the API's clock. From then on it refuses
  with `409 MESSENGER_WINDOW_CLOSED`. No `HUMAN_AGENT` tag is sent.
  `last_inbound_at` is Meta's timestamp of the customer's last message and
  only moves forward. A thread started by a seller echo has none, so the
  seller cannot reply until the customer writes. Only the send route enforces
  the window.
- **Pages.** Conversations key on Facebook's Page id, not on the
  `facebook_page` row, so disconnecting and reconnecting the same Page keeps
  its threads. A reply needs the conversation's Page to be the one connected
  now (`409 MESSENGER_PAGE_NOT_CONNECTED`).
- **Search** is a case-insensitive substring match (`ILIKE '%q%'`) on
  `customer.name` or on any message in the thread, not only the last one. The
  preview may therefore not show the match. `%`, `_` and `\` match literally.
  Search combines with `filter` and the cursor. `pg_trgm` GIN indexes serve
  terms of 3 or more characters. Request logs mask `q`
  (`common/redact-url.ts`).
- **Pagination** uses a keyset cursor on `(last_message_at DESC, id DESC)`, and
  on `(sent_at, id)` for messages. Offsets would skip or repeat rows, because
  the list re-sorts whenever a message arrives. Cursors are opaque. A cursor
  this API did not issue is `400 VALIDATION_FAILED` on `fields.cursor` or
  `fields.before`.

## Data model

The schema is in
[`customers.ts`](../../../apps/api/src/modules/database/schema/customers.ts) and
[`conversations.ts`](../../../apps/api/src/modules/database/schema/conversations.ts).
All three tables have row-level security enabled and forced, with a
`*_merchant_isolation` policy. `conversation` points at `customer`, and
`message` at `conversation`, through composite `(merchant_id, id)` foreign
keys, so a row cannot point into another shop.

- `customer` has `psid`, `name` and `picture_url` (null until Facebook shares
  them), and `profile_fetched_at`. `UNIQUE (merchant_id, psid)`, and a trigram
  index on `name`. Contact details and notes are in
  [05 · Customers](../05-customers/README.md).
- `conversation` has `facebook_page_id` (text, deliberately not a foreign
  key), `customer_id`, `state` (default `browsing`), `collected_slots` (jsonb),
  `bot_paused`, `handed_off_at`, `last_message_at`, `last_message_preview`,
  `last_message_sender`, `last_inbound_at`, and `seller_last_read_at`.
  `handed_off_at` is set with `state = handed_off` and null otherwise
  (migration `0030_conversation_handed_off_at`).
  `UNIQUE (merchant_id, facebook_page_id, customer_id)`, an index on the list
  order, and partial indexes for `handed_off` and `awaiting_confirmation`.
- `message` has `sender`, `text`, `meta_message_id` (null while `sending`),
  `payload`, `status`, `sent_at`, and `updated_at`. `payload` is a tapped quick
  reply's or button's payload, else null (migration `0033_message_payload`).
  `updated_at` is a reply's last claim to be sent, which the assistant's
  Confirm redelivery leases (migration `0034_message_updated_at`).
  `UNIQUE (merchant_id, meta_message_id)`, deleted with its conversation, and
  a trigram index on `text`. The assistant writes `assistant` rows through
  `OutboundMessageSender`.

**The Page resolver.** The worker must find a Page's merchant before any
merchant context exists. `app_page_merchant(text)` returns that merchant id, or
NULL for a Page no shop has connected. It is `SECURITY DEFINER` with a pinned
`search_path`. `EXECUTE` is revoked from `PUBLIC` and granted to
`app_runtime`. The function is owned by the `NOLOGIN` role
`app_page_resolver`, which may only `SELECT` `page_id` and `merchant_id` from
`facebook_page` (policy `facebook_page_resolver_read`). The migrating role must
be a superuser or hold `SET` membership in `app_page_resolver`. Migrations
`0009` and `0011` create the role and the function. Call it through
`resolvePageMerchant()`.

## Web

- **`/conversations`** lists the threads with the filter tabs, their counts,
  and search. **`/conversations/:id`** opens one thread beside the list. The
  thread shows who it is with, who is answering (Take over or Hand back), the
  messages, and the reply box. Nothing polls. One `EventSource` on
  `GET /events` invalidates whatever a change touches, and the sidebar's badge
  stays live on every page.
- **Eager replies.** Enter sends the reply and clears the box at once. The
  thread shows the reply from a local copy until the API answers. A chat's
  replies go out one at a time, in order, through one mutation scope. A failed
  reply shows Retry and Remove under it. The box is closed outside the 24-hour
  window, which the API enforces anyway.
- **Beside the thread,** from `xl` up, the panel shows two sections. The
  customer section has the name, phone, delivery address, order count and
  total spent, from `GET /customers/:id`. The order section has the chat's
  latest order (`GET /orders/:id`): its lines, delivery, total, and payment
  method. A drafted (`new`) order offers Confirm order, which is the seller's
  second confirmation, and Edit order, which opens `/orders/:id`. A later order
  offers View order. The route builds the panel from `ChatCustomerDetails`
  (customers) and `ChatOrderSummary` (orders), so the conversations feature
  imports neither.
- **Below `xl`,** the same two sections are a screen of their own,
  **`/conversations/:id/details`**, opened from the person icon in the chat's
  header. The screen takes the chat's place instead of nesting inside it, with
  a back link and a breadcrumb to the chat. While the chat's order is drafted,
  `ChatOrderBanner` shows a card above the reply box ("Order drafted · ৳3,260",
  "Tap to review and confirm") that opens the same screen.
- **Days** split at the shop's midnight, in its time zone
  ([Settings – General](../06-settings-general/README.md#dashboard)).
- The code is in `apps/web/src/features/conversations/`, and the routes are
  under `apps/web/src/routes/_app/conversations/`.

## Follow-ups

- Show the customer's order list beside the thread. The panel and the Details
  screen show only the chat's latest order.
- Add per-shop auto-resume after a takeover (Never, 1 h, or 24 h) in
  Settings › Assistant. The settings API exists
  ([06](../06-settings-general/README.md)). This needs its own settings and the
  job that resumes.
- Add the `HUMAN_AGENT` tag after App Review, if pilots ask for it.
- Apply `WORKER_CONCURRENCY`, or remove it. No processor reads it. The inbound
  processor runs at BullMQ's default concurrency of 1.
- Turn an abandoned `sending` reply into `failed`. A reply stays `sending` if
  the process dies mid-send or the final write fails. The web shows a stored
  `sending` row in place of its local copy, but nothing marks it failed. A
  sweep should.
- Decide whether a failed reply should undo the pause. Today it still pauses
  the assistant.
- A send that times out may still have been delivered. It is recorded as
  `failed`, and its echo carries our app id and is skipped, so retrying it can
  send it twice.
- If an echo of our own reply arrives without our `app_id` before the reply is
  marked `sent`, the ingest stores it first. `markSent` then hits
  `UNIQUE (merchant_id, meta_message_id)`, which gives a 500 and a doubled
  message.
- An SSE stream is closed at session expiry, not on sign-out elsewhere or on
  revocation. Until expiry, it still exposes conversation ids.
- Events are lost while the API's Redis subscriber is reconnecting, and when a
  publish fails. The publisher logs the failure and swallows it.
- Before the first production deploy that carries the job `kind`, check
  `bull:messenger-inbound:wait`. The worker reads a job without a `kind` as a
  customer message, but confirm what is waiting.

The assistant's own follow-ups are on the
[phase 11.1](../11-ai-implementation/phase-1-foundation/README.md#follow-ups) and
[phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#follow-ups)
pages.
