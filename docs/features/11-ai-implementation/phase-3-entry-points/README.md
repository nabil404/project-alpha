# 11.3 · Entry points

**Status:** built (Oct 2026). The three manual runs on the dev Page, and the
browser check of the new dashboard screens, are still to do
([Done when](#done-when), [progress](../progress.md)).

## Goal

A conversation starts with context instead of a blank "hi": a Get Started
button and menus to browse the catalog, a Messenger link or QR code per
product, and click-to-Messenger ads that name the product.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md): matching, facts and the
summary card. A product chosen from an entry point goes straight to the
variant question (or to the quantity, for a product with one variant).

## Flow

Every entry event becomes a stored customer message carrying one of our
payloads and runs through the existing assistant turn, so the gate, the
24-hour window, staging, the lease and the resend all apply unchanged.

- **A tap or a referral** is stored by the ingest with its payload and
  `entry_source`, and queues an `assistant-turn` with no delay.
- **The turn** reads the tap as an entry (`entryIn`) and calls `decideTurn`
  with an `entry` trigger. **An entry makes no LLM call**: the reply is a fixed
  template per language (`fallbackText`), like a pick tap.
- **One exception:** a referral that arrives with words of the customer's
  own ("how much is this one" typed into an `m.me` link's message). The ingest
  decides this, not the turn: only a typed message stores `ref-typed`. The
  product is added first, then the normal LLM turn runs on the text with that
  item collected, and the product's photo is sent before the reply. If the
  order is already at `MAX_ORDER_ITEMS`, the turn hands off without the LLM. A
  bare referral or a Get Started tap stores `ref` and takes the no-LLM path.
- **A handed-off or paused chat** stores the row and its source and replies
  with nothing, as for any message.

## What is built

### Payloads and entry sources

- **Payloads** (`packages/shared/src/schemas/assistant-payload.ts`) gain
  `start`, `browse`, `browse:cat:<id|other>`, `choose:product:<id>`,
  `ref:product:<id>`, `ref-typed:product:<id>`, `menu:last-order` and
  `menu:human`. An ice breaker of
  kind `ask` sends `ask`, which is deliberately **not** parsed, so it runs as
  an ordinary message whose text is the question.
- **`entry_source`** (`ad`, `link`, `get_started`, `organic`; shared
  `entrySources`) is on the conversation and on the order. It records how the
  **current order attempt** started: every entry event overwrites it, and
  `slotsForNextOrder` resets it to `organic` when a confirmed chat starts its
  next order. `OrdersService.createInTransaction` copies it onto an
  `assistant` order; a seller's order has `entry_source = null`.
- **Why `entry_source`, not `source`.** The phase's first draft called the
  conversation column `source`. `order.source` (`assistant` or `seller`)
  already exists and means something else, so both new columns are
  `entry_source`. The dashboard does not show it yet ([Follow-ups](#follow-ups)).

### Webhook and ingest

- **Parsing** (`messenger/webhook-payload.ts`). `parseReferral` reads
  `referral` from `message.referral`, `postback.referral` and a top-level
  `referral` event. A `ref` that matches `^p_<uuid>$` (shared
  `parseProductRef`) is a link; `source: 'ADS'` with an `ad_id` is an ad;
  anything else is organic.
- **Jobs.** `CustomerMessageJob` and `CustomerPostbackJob` gain an optional
  `referral`. The standalone event is a new `CustomerReferralJob` with the id
  `rf-` + sha256 of `psid|timestamp|ref|ad_id`, so a redelivery dedupes. The
  worker's job schema (`InboundMessageProcessor`) accepts `customer-referral`
  and `referral`.
- **Ingest** (`inbound-message.ingest.ts`, `entryOf`), inside the locked
  merchant transaction:
  - **A link** stores `ref:product:<id>` as given; the turn validates it.
  - **An ad** upserts `ad_product` (`recordSeen`: insert, or bump
    `last_seen_at` and `chat_count`). A mapped ad stores `ref:product:<id>`.
    An unmapped one stores no product: on a message the chat is organic apart
    from `entry_source = ad`. `recordSeen` runs before the message insert, and
    a duplicate delivery throws to roll the count back, so a redelivery does
    not double-count.
  - **Typed or not** is decided here. A product referral on a typed message
    (`customer-message`) stores `ref-typed:product:<id>` and keeps the message
    text. On a postback or a standalone referral it stores `ref:product:<id>`.
  - **Get Started** stores `start` and `entry_source = get_started`. With a
    referral on the postback it stores the `ref:` payload instead, and the
    source comes from the referral.
  - **A standalone referral** stores a customer row whose text is a fixed
    line in the shop's language (`REFERRAL_TEXT`: "Opened a link to a product"
    or "Came from an ad"). With no usable product (an unmapped ad) it stores
    `browse`, so the turn answers with the categories rather than running the
    LLM on a line the customer never wrote; `entry_source` still comes from
    the referral.

### Browsing

`browseReply` (`entry-replies.ts`), from `findSellableCatalog`. Browsing
changes neither `state` nor the slots.

- **Categories as quick replies** (`browse:cat:<id>`), only those with at
  least one sellable product that has an available variant. Products with no
  category share an "Other" chip. At most 12 categories plus "Other" (13, the
  quick-reply cap). With a single bucket, Browse goes straight to its
  products.
- **A carousel** (generic template, `outgoing.ts` and `MetaGraphClient`) of at
  most 10 products in catalog order: cover image, name, "From <lowest
  available variant price>" through `formatMinorUnitsTrimmed`, and a **Choose**
  button (`choose:product:<id>`). With more than 10, a fixed line follows:
  "Don't see it? Type its name."
- **Nothing available** at all hands off (`awaiting_seller`) instead of
  showing an empty list.

### Product entry

A `choose` or `ref` payload runs `decideTurn` with a `product` entry
(`ref-typed` too, before the LLM turn; see [Flow](#flow)):

- The id must be in the sellable catalog, which proves the product is active
  and belongs to this merchant. If it is not, the entry is ignored and the
  turn answers as Browse.
- If valid, an item is appended (`addProduct`), unless the same product is
  already an item without a variant. From `awaiting_confirmation` the chat
  moves to `collecting_details` with `revision + 1`, retiring the old card.
  The normal flow follows: the product's photo, then the variant question.
- **At `MAX_ORDER_ITEMS` (10) items**, a product entry hands off
  (`awaiting_seller`): nothing is added or shown, and the seller answers.

### Menu

- **My last order** (`menu:last-order`): the read phase loads the customer's
  latest order (`OrdersRepository.latestForCustomer`, merchant-scoped). The
  reply is a fixed template: reference, translated status, total. With no
  order it says so. State is unchanged.
- **Talk to a person** (`menu:human`): hands off with `request_human` and its
  fixed reply.

### Messenger Profile

`buildMessengerProfile` (pure, `messenger/profile/messenger-profile.ts`)
returns the Graph body: a Get Started button (payload `start`), the greeting
(`{first_name}` becomes `{{user_first_name}}`), the ice breakers (payload
`browse` or `ask`) and a persistent menu of Browse products, My last order and
Talk to a person, labelled in the shop's language. The menu and Get Started
are fixed in code. Meta replaces each field it is sent and the whole profile
is sent every time, so a resend is idempotent.

- **`MetaGraphClient`** has `setMessengerProfile` (`POST /me/messenger_profile`)
  and `clearMessengerProfile` (`DELETE` with the same field names).
- **`MessengerProfileSync`** (provided by `FacebookPageModule`; its processor
  is worker-only). `request` stamps `profile_sync_requested_at` and queues a
  `sync-profile` job with a unique id per request; the run reads the latest
  Page and settings, calls Graph with no transaction open, then writes
  `profile_synced_at` or `profile_sync_error`. A new request clears the old
  error.
- **When it runs:** after Page connect and reconnect, a Welcome screen save, a
  General settings save that changes the country (and so the language), and
  the one-off backfill.
- **Retries and errors.** Three attempts, with exponential backoff from 10 s
  (10 s, then 20 s) to ride out a short Graph outage. Graph error 190 or a 401
  records `token_invalid` and is not retried; any other failure records
  `graph_error` and retries. Decrypting the token is inside the same try. The
  token is never logged.
- **Disconnect:** the row is deleted, then the profile is cleared with that
  token (best effort; a failure is logged without the token), then the app is
  unsubscribed.
- **Status** on the wire: `pending` when requested after the last sync;
  `failed` when an error is newer than the last request; `live` otherwise;
  `not_connected` without a Page.
- **Backfill.** `PAGE_WEBHOOK_FIELDS` gains `messaging_referrals`, and a Page
  subscribed earlier has the old list. When the worker starts it queues
  `resubscribe-pages` with the fixed job id `resubscribe-pages-v1`, kept after
  completion, so it runs once. It lists every connected shop through
  `app_connected_merchants()` and queues a profile sync with `resubscribe`
  for each, which re-posts `subscribed_apps` (a replace, so idempotent) before
  setting the profile. Sellers do not reconnect. It has five attempts with
  exponential backoff from 30 s, so a blip at deploy does not strand Pages; a
  job that still fails is dropped after the queue's 24 h `removeOnFail` and
  re-added by the next boot. **To run it again** for a new field, bump the id
  (`-v2`).

### Welcome screen and ads (API)

Both routes sit behind the session and `TenantGuard`.

| Route                             | Behaviour                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings/messenger-welcome` | Greeting and ice breakers (the defaults for the shop's language until saved, flagged `isDefault`), and `profileSync: { status, syncedAt, error }` |
| `PUT /settings/messenger-welcome` | Validates with the shared schema, saves, queues the sync, and returns the same shape with `profileSync.status = pending`                          |
| `GET /messenger/ads`              | `{ data }`: `ad_product` rows, newest first, with the mapped product's id, name and status; `product` is null until mapped                        |
| `PATCH /messenger/ads/:id`        | `{ productId: string \| null }` maps or unmaps. A Draft product is allowed (the turn ignores it until Published); an archived one is not          |

Errors, as the routes' `@ApiCodedError` decorators declare them
(`welcome-screen.controller.ts`, `ad-products.controller.ts`):

| Route                             | Status | Code                   | When                                                                                               |
| --------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `PUT /settings/messenger-welcome` | 400    | `VALIDATION_FAILED`    | A greeting or question that is empty or too long, more than four ice breakers, or an unknown field |
| `PATCH /messenger/ads/:id`        | 400    | `VALIDATION_FAILED`    | A body that is not `{ productId }` with a UUID or null; a non-UUID `:id`                           |
| `PATCH /messenger/ads/:id`        | 404    | `AD_PRODUCT_NOT_FOUND` | No such ad for this shop (`{ id }`)                                                                |
| `PATCH /messenger/ads/:id`        | 404    | `PRODUCT_NOT_FOUND`    | The product is not this shop's                                                                     |
| `PATCH /messenger/ads/:id`        | 409    | `AD_PRODUCT_ARCHIVED`  | The product is archived (`{ productId }`)                                                          |

- **Limits** (`packages/shared/src/schemas/messenger.ts`): greeting at most
  160 characters, at most four ice breakers of at most 80. They count code
  points, as Meta does, and an over-long text is reported as `MAX_LENGTH` with
  `{ max }`. The greeting is counted as sent: each `{first_name}` becomes
  `{{user_first_name}}`, seven characters longer, so a greeting the dashboard
  accepts is never refused by Graph.
- **`AD_PRODUCT_ARCHIVED`** is a new `ErrorCode`, with entries in
  `apps/web/src/i18n/error-keys.ts` and `errors.json` (the three-file change).

### Data

`db:verify-rls` passes.

- **Columns** (generated): `conversation.entry_source` (not null,
  default `organic`) and `order.entry_source` (null), each with a check
  against the shared list; `merchant_settings`
  `messenger_greeting` and `ice_breakers` (jsonb, parsed with Zod on read; null
  means the defaults); and `facebook_page` `profile_sync_requested_at`,
  `profile_synced_at` and `profile_sync_error`.
- **`0035_entry_points_force_rls`** (`db:custom`): `FORCE ROW LEVEL SECURITY` on
  `ad_product`, the composite foreign key `(merchant_id, product_id)` to
  `product` with `ON DELETE SET NULL (product_id)` (drizzle-kit cannot express
  the column list, so it lives only here), and an index on the product.
  Deleting a product unmaps its ads; another shop's product id is refused by
  the key.
- **`0013_facebook_page_force_rls_resolver`** (`db:custom`): `app_connected_merchants()`,
  a `SECURITY DEFINER` function owned by `app_page_resolver`, like
  `app_page_merchant()`. It returns only merchant ids, so the one-off
  re-subscribe job can list shops before any merchant context exists.
- **`ad_product`** (`0033_ad_product`): `merchant_id`, `page_id`, `ad_id`, `product_id` (null =
  seen but not mapped), `first_seen_at`, `last_seen_at`, `chat_count`. Unique
  on `(merchant_id, ad_id)`, with the isolation policy.

### Dashboard

- **Settings › Messenger › Welcome screen** (`WelcomeScreenCard`): a form on
  the shared schema with counters, up to four questions (each Browse or Ask)
  and **Save and update Page**. While the sync is `pending`, the query polls
  every 3 s for at most 60 s after a save in this tab, or after the card
  first saw it pending (a Page connect, or a sync queued elsewhere), then
  shows "Updating…" until a reload. Questions carry no help text, and on
  desktop each is numbered. Only the greeting keeps a hint, for
  `{first_name}`. The card no longer lists Get Started and the chat menu,
  which sellers cannot change. A failed
  sync shows a banner with Retry; `token_invalid` asks the seller to reconnect.
  The greeting field left the Replies card. An info button beside the
  card's title (`InfoTip`, a popover that opens on hover, keyboard focus or
  a tap) says Meta Business Suite doesn't show these settings, so they are
  edited here. Checked on the dev Page (Oct 14, 2026): after a sync,
  `GET /me/messenger_profile` returned our Get Started, ice breakers and menu,
  while Business Suite's **Inbox › Automations › Frequently asked questions**
  stayed off and empty, so it keeps its own record. Whether turning it on
  replaces the Page's ice breakers is unchecked; our next sync replaces the
  whole profile either way. Get Started and the persistent menu have no
  editor in Meta's tools. They show in Messenger only on a new conversation
  (the menu in any chat).
- **Settings › Messenger › Click-to-Messenger ads** (`AdProductsCard`): a
  table on desktop and cards on a phone. Each row has a searchable product
  picker that saves at once with an optimistic update, and unmaps with a null.
  A Draft product shows a note that the assistant ignores it until Published.
  The picker lists the newest 100 non-archived products and says so when there
  are more ([Follow-ups](#follow-ups)). A mapped product missing from that
  list (archived since, or older than the newest 100) is still named in its
  row, labelled by its status: plain when active, "(Draft)" or "(archived)".
- **Product page › Messenger link** (`MessengerLinkCard`): the link
  `https://m.me/<pageId>?ref=p_<productId>` (`m.me` accepts the numeric Page
  id), **Copy**, a QR code and **Download QR** (PNG). The QR is drawn in the
  browser with `qrcode`, so nothing is stored. Without a connected Page it
  shows "Connect your Page to get a link"; a product that is not Published
  gets a note. A failed copy or download shows a toast.

## Decisions

- **One path (approach A).** Every entry is a stored customer message run
  through the existing turn. Rejected: a separate entry-point service, which
  would duplicate the gate, window, staging, lease and resend; and a pending
  product read on the next message, where the assistant would not speak first.
- **`entry_source` on the conversation and copied to the order**, and named so
  because `order.source` exists.
- **A referral mid-conversation appends an item**; from `awaiting_confirmation`
  it retires the card with `revision + 1`.
- **Only the greeting and ice breakers are editable.** Get Started and the
  persistent menu are fixed in code and translated by shop language.
- **An unusable referral is never an error to the customer** (a bad `ref`, an
  unmapped ad, an archived or another shop's product, a malformed body): they
  get the browse reply, or an organic turn, and the source is still recorded.
- **A profile sync failure never blocks** a save or a connect.
- **The QR code is drawn in the browser.** Rejected: a server endpoint, which
  adds a route and image hosting for no gain.
- **The ads picker is capped at 100 products.** The shared Combobox has no
  typed-text callback, so a server search needs a new variant.

## Meta / App Review

`messaging_referrals` is added to `PAGE_WEBHOOK_FIELDS`. Pages connected
earlier are re-subscribed by the worker's one-off job, so sellers do not
reconnect. The Messenger Profile API uses the Page token and `pages_messaging`;
no new permission. See [Meta setup](../../../setup/meta-setup.md#messenger-profile-phase-113).

## Rules it keeps

A referral's product becomes a fact only after it is found in the sellable
catalog (active, this seller's). Menus and the carousel never quote a price
that is not from the catalog, and "From" is the lowest **available** variant.
Entries make no LLM call and no Graph or LLM call runs inside a transaction.
See the MVP [rules](../../../mvp/01-messenger-to-order/rules.md).

## Tests

- **Shared:** `webhook-payload.spec.ts` (`messenger/__tests__/`) covers
  referral parsing for a link, an ad and Get Started, a `ref` that is not
  `p_<uuid>`, an ad without `ad_id`, and the stable `rf-` id.
- **`entry-points-schema.spec.ts`** (`database/__tests__/`, DB): the check
  constraints and defaults.
- **`ad-product.repository.spec.ts`** (DB): two-shop isolation for list, map
  and upsert, the `chat_count` bump, and `ad_product_product_fk` (deleting a product clears
  `product_id`; another shop's product id is refused).
- **`inbound-message.ingest.spec.ts`** and `inbound-message.processor.spec.ts`
  (DB): an ad upserts and bumps; a mapped ad stores `ref:product:`;
  `entry_source` is written and reset for the next order; a redelivery does
  not double-count; a handed-off chat stores the row and queues nothing.
- **`conversation-machine.spec.ts`**, `entry-replies.spec.ts`,
  `entry-payload.spec.ts`, `outgoing.spec.ts`: browsing hides empty and
  sold-out categories, the "Other" bucket, the single bucket, the 10-card cap;
  a product entry ignores another shop's or an archived id, appends, does not
  duplicate, gives `revision + 1` from a card, hands off at 10 items;
  `lastOrder` with and without an order; `human`; the carousel's template.
- **`inbound-message.ingest.spec.ts`** also pins typed or not: a message with
  a link or a mapped ad stores `ref-typed:`, a Get Started postback with a
  link stores `ref:` from the link, and an unmapped standalone ad stores
  `browse` from the ad.
- **`assistant-turn.service.spec.ts`** (DB): a `ref-typed` runs extraction
  with the item collected and sends the product's photo first, and hands off
  without the LLM at 10 items; Get Started carrying a `ref` asks the variant
  with the photo and no LLM call; a `browse` from an unmapped ad answers with
  the categories; entry triggers make no LLM call.
- **`messenger-profile.processor.spec.ts`**: the resubscribe job's fixed id and
  retries.
- **`messenger-profile.spec.ts`**, **`messenger-profile.sync.spec.ts`**
  (`messenger/profile/__tests__/`), `profile-sync-of.spec.ts`: the body per
  language; the sync twice sends the same body; 190 records `token_invalid`
  with no retry; a decrypt failure records `graph_error`.
  `facebook-page.service.spec.ts` and `facebook-page.repository.spec.ts`
  (`page/__tests__/`): connect queues a sync; disconnect clears the profile
  before the app is unsubscribed.
- **`welcome-screen.e2e.spec.ts`** and **`ad-products.e2e.spec.ts`** (DB and
  Redis, HTTP): the limits and the error tables above, isolation, and the
  `pending` status after a save.
- **Orders:** `createInTransaction` copies `entry_source` for the assistant
  origin and leaves it null for the seller (`orders.e2e.spec.ts`).
- `apps/web` has no test runner; the three screens above are covered by
  `typecheck` and `lint` only.

## Follow-ups

- Run the three manual checks below on the dev Page, and look at the Welcome
  screen, Ads and Messenger link cards in a browser, including at 375 px and
  with a real QR scan. The browser check was not run in this change.
- The greeting does not stick. On the dev Page (Oct 14, 2026) the sync's
  `POST /me/messenger_profile` succeeded, but a `GET` returned Get Started,
  ice breakers and the menu with no `greeting`. Not yet known whether Meta
  drops it or our body is wrong; test a greeting-only update and read it back.
- Whether Graph accepts an empty `ice_breakers` list to clear them is
  unchecked against a live Page. If it refuses, clear the field with a
  `DELETE` instead (noted in `buildMessengerProfile`).
- A shop with more than 100 products cannot map an ad to a product beyond the
  newest 100 from the dashboard. Add a server-search variant of the Combobox.
- **Known limit: Ask ice breakers mostly hand off.** The default questions
  ("What is the delivery charge?", "How do I pay?") are kept because the spec
  lists them, but they classify as `ask_question`, which hands off to the
  seller. The dashboard copy says so. Answering shop questions from settings
  is later work.
- `MessengerLinkCard` imports `sonner` directly for two plain-text failure
  toasts, since `lib/toast` has no plain-message error path.
- A native-speaker review of the Bangla menu labels, browse text and default
  welcome screen (`messenger-profile.ts`, `entry-replies.ts`,
  `welcome-defaults.ts`).
- Show `entry_source` in the dashboard and in reports; show ad names (needs
  the Marketing API); a seller-editable persistent menu; more than 10 products
  per category in the carousel.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
      pass (last run Oct 14, 2026), the new suites ran against the database,
      and `db:verify-rls` passes.
- [ ] Scanning a product's QR code on a phone opens Messenger, and the
      assistant asks for that product's variant.
- [ ] Get Started → category → product → confirmed order works on the dev
      Page.
- [ ] A test ad referral maps to a product after the seller assigns it.
