# 11.2 · Catalog matching, Confirm and orders

**Status:** built (Oct 2026). The manual run on the dev Page with a real
`LLM_API_KEY` is still to do ([Done when](#done-when),
[progress](../progress.md)).

## Goal

The assistant finds the products and variants a customer asks for in the
catalog, quotes prices and delivery only from it, shows a summary card with a
**Confirm** button, and creates exactly one order when the customer taps it.
"I want the red saree" ends as a `source = assistant` order in the Drafted
tab, with its reference sent back in Messenger and the seller emailed.

## Depends on

[Phase 1](../phase-1-foundation/README.md): the turn, the state machine and
phrased replies.

## Flow

[Confirm flow](confirm-flow.md) draws a matching turn and the Confirm tap.

- **A customer message** runs phase 1's turn, which now also reads the
  sellable catalog (`ProductsService.findSellableCatalog`), the delivery rows
  and the free-delivery threshold. `decideTurn` merges the extracted items,
  matches each product and variant, folds items on one variant together,
  checks what is available (stock less what drafts reserve), matches the
  delivery area, and asks the next question or builds the card.
- **A quick-reply tap** on an offered candidate fills its item with no LLM
  call.
- **After commit**, the matched item's photo goes first, best-effort and
  unstored, then the reply: text, text with quick replies, or the card.
- **A Confirm or Change tap** runs `OrderConfirmationService.run`, with no
  LLM, in one short transaction; the reply is sent after commit, then
  `orderDrafted`.

## What is built

- **Slots hold an item list** (`packages/shared/src/schemas/conversation.ts`):
  up to `MAX_ORDER_ITEMS` (10), each with the customer's words
  (`productQuery`, `variantQuery`), the same words in the other script
  (`*Alt`), the matched `productId` and `variantId`, and a quantity. Also
  `deliveryArea`, `deliveryChargeId`, `offered` (one item's quick-reply
  candidates), `offeredName` (the profile name offered for the order),
  `revision` (bumped by every card) and `quote` (that card's
  numbers). Phase 1's `productText` is gone; an old row parses as an empty
  list.
- **Extraction returns the whole list** (`schemas/llm.ts`,
  `llm/prompts/extract-order.ts`). Each entry has `ref`, the index of the
  collected item it continues, or null for a new one; an item left out is
  removed. The prompt shows each collected item's catalog name beside the
  customer's earlier words, and asks for the customer's words unchanged plus
  a transliteration, never a translation or catalog name. On an entry with a
  `ref`, `productQuery` is null unless the customer switched product, and
  then names only the product they want ("not katan, jamdani" gives
  "jamdani"); `variantQuery` follows the same rule. It also returns
  `deliveryArea`. While a profile name is offered, the prompt shows it as
  `offeredName`, and a reply agreeing to it ("yes", "ji", "হ্যাঁ") returns it as
  `customerName`.
- **`item-merge.ts`** (pure). `mergeItems` applies the list: a `ref` with null
  product words keeps its ids; any product words drop both ids and match from
  scratch; variant words drop only the variant. A bad or reused `ref` starts
  a new item. `mergeSameVariant` sums items on one variant.
- **`catalog-match.ts`** (pure, in memory): `matchProduct`, `matchVariant`,
  `matchArea` ([Matching](#matching)).
- **`conversation-machine.ts`.** `decideTurn` takes the catalog, the delivery
  view and a trigger (a message the LLM read, or a pick). Per item it asks
  `product`, then `variant` (only for a product with several), then
  `quantity`; then name, phone, address. A clear match fills the item; close
  candidates become quick replies; not found, out of stock, sold out, or more
  than is available each ask again with a reason and count toward the
  three-ask hand-off. A variant with none available is never offered. When
  the name is next and the customer's Facebook profile has one
  (`customer.name`, `TurnInput.profileName`), the ask is a fixed line, "Order
  under <name>? If not, type the name to use." (Bangla draft "অর্ডারটি কি
  <name> নামে হবে? না হলে নামটি লিখে দিন।"), never phrased, with the name as
  one quick reply. Tapping it fills `customerName` from `offeredName` with no
  LLM call. Anything typed is read by extraction, which sees the offer, so a
  typed "yes" fills the offered name and another name replaces it. With
  no profile name, the ask is the phrased one. With
  nothing missing it quotes every line (`quoteFor`) and moves to
  `awaiting_confirmation` with `revision + 1`. `factsOf` gives phrasing the
  catalog names and formatted prices, so `checkReply` rejects a price one unit off.
- **The summary card is built in code** (`summary-card.ts`), a fixed template
  per language. Money goes through `formatMinorUnitsTrimmed` with `bn-BD` or
  `en-US`, showing decimals only when not zero ("৪,৫০০৳", "১,৬০০.৫০৳"). It is
  a button template with **Confirm** and **Change something**, whose payloads
  are `confirm:<conversationId>:<revision>` and `change:…`. Past Messenger's
  640 characters, the item lines go first as a plain message and the card
  keeps the totals and details.
- **`outgoing.ts`** turns a decision into messages: text, text with quick
  replies (`pick:product:<id>`, `pick:variant:<id>`, `name:profile`), or the
  card. `name:profile` carries no name: the turn fills the one it offered, and
  a tap with nothing offered is read as an ordinary message. The turn
  stages each as a row in its transaction and delivers them in order after
  commit; after one is refused, the rest are marked failed unsent and the
  chat hands off.
- **`OrdersService.createInTransaction`** is `create`'s body, run inside the
  caller's transaction with an origin (`seller`, or `assistant` with its
  conversation) and a null actor for the assistant. `OrderableVariant`
  carries `productActive`.
- **Messenger.** Postbacks and quick-reply taps are stored as customer
  messages with `message.payload`
  ([Conversations](../../04-conversations/README.md)); a postback queues with
  no delay. `MetaGraphClient` sends quick replies, button templates and
  images.

## Matching

`catalog-match.ts` normalises text (NFKC, lowercase, Latin digits,
punctuation to spaces, Bangla vowel signs kept) and scores the customer's
words and their transliteration against each product's name and aliases.

- **Score.** An exact match, or every word of one inside the other, scores 1.
  Otherwise it is the better of pg_trgm's trigram similarity and (share of
  the name the customer wrote) × (share of what they wrote that is the name),
  each word allowed a misspelling at trigram similarity 0.4 or more. Words
  naming one of the product's own option values ("red jamdani") are set aside
  first.
- **Rivals.** A clear winner becomes a choice when the customer also wrote
  another product's name or alias word, misspelt or not, in either script,
  unless the winner's own words cover it: "katan jamdni" and "কাতান না
  জামদানী" both ask Katan or Jamdani.
  - Words count as alike down to the candidate floor (0.3), because a
    one-letter slip in a short name ("kuti" for "kurti") scores 0.375. A
    missed rival keeps a product the customer may have refused; an extra one
    only asks.
  - When both scripts have as many words, they are read as word-by-word
    transliterations, so "কাতান শাড়ি" with "katan shari" stays on the Katan
    though "shari" is only the Jamdani's alias.
  - Trigrams miss swaps and dropped letters in short words ("lugni" for
    "lungi"; "sat" for "set" is 0.14) and can match a rival's word ("katha"
    is 0.33 like "katan"). So a word also names a rival when it is within
    Elasticsearch's AUTO edit allowance of that rival's word (optimal string
    alignment; none under 3 letters, one up to 5, two beyond, counting code
    points), unless it is the winner's own word, or one edit from the
    winner's nearest word and strictly nearer it than any word the winner
    does not share. "katan jmadni" and "kurti lugni" ask.
  - An equal distance is a choice: "kajan" and "katal" are one edit from both
    "katan" and "kajal", so they ask. "sharee" stays with the winner because
    "saree" is a word both sarees share. Only the winner's exact word in the
    other script vouches for a twin, so "kajan" with "কাজন" still asks.
- **Variants** score by the share of their option values the customer named.
- **Areas** match the area the customer named, then an area named inside the
  address, then everywhere else.

**Thresholds** (`MATCH_THRESHOLDS`) come from a sweep over the eval set: a
clear winner scores at least 0.45 (`one`) and leads the runner-up by 0.15
(`lead`); candidates under 0.3 (`some`) are not offered; at most three
(`MAX_CANDIDATES`) are. 0.45 is the lowest value with no wrong clear winner;
at 0.4 "face cream" became Sunscreen. Rerun the sweep with
`MATCH_SWEEP=1 pnpm --filter api test catalog-match.sweep`, which prints
every combination with its rate, confident-wrong count and misses, the
shipped values marked `*`.

**Eval set** (`__tests__/fixtures/match-eval.ts`): a 16-product clothing and
cosmetics shop, 80 product messages (English, Bangla, Banglish,
misspellings, aliases, variant words, ambiguous, not sold) and 14 variant
phrases, each with the query forms extraction should return. Re-run on
Oct 13, 2026:

| Set      | Score         | Misses                                                                                                                                        |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Products | 93.8% (75/80) | "burqa", "borkha chai", "kurtee": the right product as the only quick reply. "face cream", "baby shoes": a close product offered, not nothing |
| Variants | 100% (14/14)  | None                                                                                                                                          |

Every miss offers a candidate, never picks a wrong product; the spec asserts
that. The transliterations were written by hand, often as an alias, so this
measures the matcher given good query forms. The end-to-end figure,
`catalog-match.live-eval.spec.ts` with `LLM_EVAL=1` and `LLM_API_KEY`, has not
been run.

## Confirm

`OrderConfirmationService.run` handles a Confirm or Change payload of ours.
No LLM is called; every reply is a fixed sentence per language
(`confirmText`). One short transaction:

1. **Lock the conversation.** A paused chat, a Page no longer the shop's, a
   payload naming another conversation, or a job for another merchant does
   nothing.
2. **Change** on the current card moves to `collecting_details` with
   `revision + 1` and asks what to change. On any other card it sends the
   stale sentence.
3. **Confirm when the order exists.** If an order keyed
   `assistant:<conversationId>:<revision>` exists, the run resends its
   reference, so double or racing taps make one order. If the assistant
   already replied to this tap (a reply after the tap and before the
   customer's next message):
   - a reply marked `sent` means nothing more is sent;
   - a reply `failed`, or left `sending` past `SEND_LEASE_SECONDS` (20 s,
     the worker died), is resent from its stored row by the one run that
     claims it. `MessageRepository.claimForResend` is a conditional update
     that stamps a fresh `updated_at`, so of two retries only one gets it;
   - a reply still inside its lease throws `ReplyInFlightError`, so the job
     retries: the lease holder either marks it sent, or dies and a later
     retry claims it. The lease is stamped and compared with
     `clock_timestamp()`, the claim's time, not `now()`, the start of a
     transaction that may have waited on the lock.
4. **Stale.** State not `awaiting_confirmation`, another revision, or a quote
   of another revision sends the stale sentence.
5. **Re-check every line** (`OrderCatalogRepository.findVariants`) and the fee
   (`DeliveryQuoteService.feeFor`).
   - A line archived, short of what is available, or whose product is no
     longer active: no order. That item loses its variant (and its product if
     it left the catalog), the others stay, the chat goes to
     `collecting_details` with `revision + 1`, and a sentence names it.
   - A unit price, the fee or the shop's currency changed: no order, and a
     fresh card for `revision + 1` in the current currency, after a fixed
     "the price changed" line.
6. **Create** with `createInTransaction`: the card's lines and fee, the
   slots' name, phone and address, cash on delivery. It reserves the lines'
   stock. If another order took it since the re-check, the order is refused
   with `ORDER_INSUFFICIENT_STOCK`, nothing is written, and the customer gets
   the normal "unavailable" reply. Otherwise state becomes `confirmed` and the
   reference is staged.

After commit the reply is sent, then `NotificationsService.orderDrafted` for
the card's order, whether this run made it or found it. Its job id
`order-drafted-<orderId>` makes a repeat a no-op for the seven days the job
is kept (`EVENT_JOB_RETENTION`). The lock order is conversation, then
settings row; a seller-made order takes no conversation lock, so there is no
cycle.

## Decisions

- **Multi-item orders.** The operator chose a list of items over a single
  line, so the quote has `lines`, the card a line per item, and Confirm
  re-reads every line.
- **A button template, not a generic one.** A generic template's 80
  characters per field cannot hold the items, totals and details; the photo
  goes as its own image message.
- **No LLM writes a number on the card.**
- **The profile name is offered, never filled.** It goes on the parcel and
  the courier slip, and profile names are often nicknames or in another
  script, so the customer confirms it with a tap or types another.
- **Money the customer reads drops zero decimals.** The card and the phrasing
  facts share one formatter; `checkReply` also accepts "৪,৫০০.০০" for
  "৪,৫০০" and holds "১,৬০০.৫০" to its paisa.
- **Extraction decides a switch, not the matcher.** Three fixes tried to tell
  "same product" from "switch" by reading the words on a picked item, and
  each missed a spelling. Now extraction returns product words on a picked
  item only for a switch, and any words re-match from scratch; the rival
  guard covers an extraction that still names both. Some extraction mistakes
  end on a wrong card, which the customer reads before Confirm:
  - only the refused product's words ("katan" for "not katan, jamdani"),
    which match it clear;
  - a missed change returned as null words, which keep the old pick;
  - a wrong `ref` with variant words, giving that variant to another item
    with the same value;
  - an item left out of the list, which is removed;
  - a new entry repeating an item that also has its `ref`, which lands on the
    same variant with the quantities summed.
- **A redelivery is leased, not just checked.** Retries of one Confirm run
  serially under the conversation lock but send after commit, so a status
  read let two of them send the same reference. The lease needed a time, so
  `message` gained `updated_at`. 20 s is past the Graph
  call's 10 s timeout and short of the 30 s after which BullMQ reruns a job
  whose worker died. Turns back off from 3 s over five attempts
  (`ASSISTANT_TURN_RETRY`), so at least 24 s follow every attempt but the
  last; the queue default (1 s) would give up inside the lease.
- **Matching runs in memory, not in Postgres `pg_trgm`**, by judgement, not
  measurement. Most of the matcher is per-word logic pg_trgm lacks (word
  ownership, edit-distance rivals, script twins, the one, some or none
  decision); the turn already holds the catalog for prices and availability;
  and a pure matcher lets tests run tens of thousands of queries without a
  database. Unchecked risk: pg_trgm splits words by the database locale,
  which may mishandle Bangla. At thousands of products, fetch about 20
  candidates with pg_trgm over a GIN index and keep this code for the
  decision.
- **Matching is hand-written, not Fuse.js.** On 2026-10-11, against the same
  80 cases, Fuse 7.1.0 (keys name and aliases, `ignoreLocation`, best of both
  query forms) under the same rule reached 88.8% with no confident-wrong
  match, against 93.8% for `catalog-match.ts` at `659c677`; it reached 93.8%
  only with 3 confident-wrong matches ("pink hijab" offered the Panjabi).
  Fuse also scores a whole item, while the rival guard needs each word's
  owner. The eval set was written while tuning this matcher and may favour
  it.
- **A tap resolves by its payload's id**, never by re-matching its shortened
  title, and only when the last reply offered that id. A pick skips every LLM
  call, phrasing included.
- **The delivery area comes from the address**; there is no area question. A
  complete order with no area match and no everywhere-else row hands off as
  `no_delivery_charge`.
- **A quote is pinned to its revision**, and Confirm orders only when every
  number still holds.
- **Stock is a yes/no fact.** Facts carry `inStock`, plus `available` only
  when the customer asked for more; both read available (on hand less what
  drafts reserve). The customer's Confirm reserves the stock; the seller's
  confirm takes it.
- **The ask counter follows its item** through removals and reorders, by
  `ref`, then by the same-variant merge.
- **An invalid phone is asked again at once**, as in phase 1.
- **Hand back retires a paused card.** The seller may have agreed other
  terms, so `ConversationsService.update` moves it to `collecting_details`
  with `revision + 1` and no quote in the un-pause's transaction.
- **A turn that leaves the card without a new one retires it**, as Change
  does: an ask or hand-off after the card clears the quote and bumps the
  revision.
- **A message after the card that changes nothing** hands off as
  `awaiting_seller`, as in phase 1; a change sends a new card.
- **The card's length is counted in code points**, stricter than graphemes,
  to match the Graph client's cut.
- **`ask_question` still hands off.** Answering delivery, payment and catalog
  questions is unplanned.
- **The photo is not stored.** It is sent before the reply, best-effort, and
  its echo is skipped as our own.

## Meta / App Review

`messaging_postbacks` was already in `PAGE_WEBHOOK_FIELDS`. No new
permission.

## Rules it keeps

No order without the Confirm button; prices, variants, stock and delivery
charges only from the catalog and the shop's settings; one order per card
revision; no LLM or Graph call inside a transaction. See the MVP
[rules](../../../mvp/01-messenger-to-order/rules.md).

## Tests

In `apps/api/src/modules/conversations/assistant/__tests__/` unless noted.

- **`catalog-match.spec.ts`**: pg_trgm's similarity; exact, alias,
  misspelling, Banglish and Bangla matches; at most three candidates; rivals
  beside a full name ask in either script, unless the twin is the winner's;
  rivals garbled past trigrams ("katan jmadni", "kurti lugni", "kurti sat");
  for every pair of eval products, A's name with B's word one edit off never
  names A clear; equally near typos offer both; no single typo of any Latin
  name or alias word, alone or beside its Bangla alias (about 29,700
  queries), names another product clear; nothing for products not sold;
  variants, out of stock, areas, addresses and the fallback.
- **`catalog-match.eval.spec.ts`**: at least 90% for products and variants and
  no wrong clear winner; prints the misses.
- **`catalog-match.live-eval.spec.ts`** (`LLM_EVAL=1`) and
  **`catalog-match.sweep.spec.ts`** (`MATCH_SWEEP=1`): the live model, and the
  threshold sweep.
- **`item-merge.spec.ts`**: refs, null and echoed words, removal, bad and
  reused refs, the same-variant merge.
- **`conversation-machine.spec.ts`**: every state × intent; variants only with
  options; picks; not found to hand-off; stock; "make the second one 3";
  switches ("not the A, the B", "B instead of A", "A na B" in both scripts,
  for every pair of eval products); removal and the ask counter; summary,
  revision, own charges, threshold, fallback; retiring the card; the photo;
  the profile name offered only when the name is next, filled only by a tap,
  replaced by a typed name, dropped on a hand-off, absent without one.
- **`reply-check.spec.ts`**, **`summary-card.spec.ts`**, **`outgoing.spec.ts`**,
  **`assistant-fallbacks.spec.ts`**: price checks in both digit sets; card
  text, notice line and the 640-character split; payloads; a sentence per
  reason in both languages.
- **`assistant-turn.service.spec.ts`** (DB): the photo first; candidates and a
  tap with no LLM call; the profile name offered as a quick reply and a tap
  filling it with no LLM call, a typed name, a typed "yes" with the offer in
  the extraction context, no offer without a profile name,
  a name tap with nothing offered read as a message, and no other merchant's
  customer's name; an unoffered tap read as a message; the card's
  revision in its buttons; a card tap routed to Confirm.
- **`order-confirmation.service.spec.ts`** (DB): one order with the card's
  numbers and `orderDrafted` after commit; double and racing taps; resends
  under the lease, including two concurrent retries; a fee-only change; a
  retry after `orderDrafted` threw; stale, paused, other conversation or
  merchant; an archived line, a drafted product, short stock, a lost race for the
  last unit, a price or currency change; Change; fee parity with
  `POST /orders/delivery-quote`; the old card refused after a hand-back.
- **`conversation-simulator.spec.ts`** (harness in `simulator/`): plays a
  scripted conversation through the worker's code against the local
  database, from signed webhook bodies through `InboundMessageProcessor` and
  `AssistantTurnProcessor`, with no Redis or HTTP and a fake Graph client
  that echoes like Meta. It prints each step's input, sends, state, slots and
  orders. Scenarios: the golden path ("I want the red saree and 2 blue
  kurtis" to Confirm twice, one order); "make the saree 3" after the card;
  the same with "saree" echoed; "not katan, jamdani". Run
  `pnpm --filter api test conversation-simulator`; with `LLM_EVAL=1` and a
  key, phrasing is live and a turn may differ from the script.
- Elsewhere: `conversations/__tests__/message-claim.spec.ts` (DB, the lease
  clock and the merchant filter on `claimForResend`),
  `queue/__tests__/assistant-turn-retry.spec.ts` (the backoff outlasts the
  lease), and `messenger/__tests__/webhook-payload.spec.ts` with
  `messenger/page/__tests__/meta-graph.client.spec.ts` (payloads and the
  three new Graph sends).

## Follow-ups

- Run the live extraction model on typed agreements to the profile-name
  offer ("yes", "ji", "হ্যাঁ", "ঠিক আছে"), and on replies that only look like
  one, and record the result here. The specs fake extraction, so only the
  prompt covers it today.
- A native-speaker review of the Bangla card labels and sentences
  (`summary-card.ts`, `assistant-fallbacks.ts`).
- Run `catalog-match.live-eval.spec.ts` with the live model and record the
  score here.
- A Confirm tapped more than seven days after its order queues `orderDrafted`
  again once the first job has aged out, emailing the seller twice.
- No `conversations.service` spec covers the inbox echo that pauses the
  assistant before a hand-back retires the card.
- A Confirm send still in flight after the 20 s lease (a stalled, not dead,
  worker) can be sent again by a rerun. A run that dies on the last attempt
  leaves its reference unsent until the customer's next tap.
- A freshly staged reply's `updated_at` is `now()`, the start of the staging
  transaction, so its lease is short by that transaction's run time.
- A redelivered row goes out as plain text, since the stored row keeps no
  quick replies or buttons.
- `checkReply` joins digit runs across separators, so "1.20" can match "120",
  and it does not compare spelled-out numbers ("two hundred").
- A deleted delivery area under a shown card sends the stale sentence; it
  could send a fresh card at once.
- Show the product photo in the dashboard thread.
- `cutText` in `meta-graph.client.ts` counts code points. Check how Messenger
  counts before loosening it to graphemes.
- A postback with neither `mid` nor timestamp gets a clock-based id, so its
  redelivery is not deduplicated.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
      pass (last run Oct 13, 2026).
- [x] Tapping Confirm twice creates one order
      (`order-confirmation.service.spec.ts`).
- [x] The eval set reaches the ≥ 90% product identification target from the
      [success metrics](../../../mvp/01-messenger-to-order/success-metrics.md),
      given the query forms.
- [ ] Manually, with a real `LLM_API_KEY`: a conversation on the dev Page
      goes from "I want the red saree" to a `source = assistant` order with
      its reference sent back; it shows under the Drafted tab at `/orders`,
      and the seller gets the email.
