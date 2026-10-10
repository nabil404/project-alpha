# 11.2 · Catalog matching, Confirm and orders

**Status:** built (Oct 2026). The live run on the dev Page with a real
`LLM_API_KEY` is still to be done by the maintainer (see [Done when](#done-when)).

## Goal

The assistant finds the products and variants a customer asks for in the
seller's catalog, quotes prices and delivery only from it, shows an order
summary with a **Confirm** button, and creates exactly one order when the
customer taps it. This completes the MVP's core flow: "I want the red saree"
ends as a `source = assistant` order in the Drafted tab, its reference sent
back in Messenger and the seller emailed.

## Depends on

[Phase 1](../phase-1-foundation/README.md): the assistant turn, the state
machine and phrased replies.

## Flow

```
Customer message      → AssistantTurnService.run (as phase 1), plus in step 1:
                          the sellable catalog (ProductsService.findSellableCatalog)
                          and the shop's delivery rows and free-delivery threshold
  trigger is a pick   → the tapped candidate fills its item; no LLM call at all
  otherwise           → classify → extract (the whole item list) → decideTurn:
                          mergeItems → match each item's product and variant
                          → merge items on the same variant → stock check
                          → match the delivery row → next ask, or the summary
  after commit        → the matched item's photo (best effort, unstored), then the
                          reply: text, text + quick replies, or the summary card
Confirm / Change tap  → OrderConfirmationService.run, no LLM:
                          one short transaction: lock the conversation, re-read every
                          line and the fee, create the order (or say why not), stage
                          the reply; after commit send it, then orderDrafted
```

## What is built

- **Slots hold an item list** (`packages/shared/src/schemas/conversation.ts`):
  up to `MAX_ORDER_ITEMS = 10` items, each with the customer's words
  (`productQuery`, `variantQuery`), the same words in the other script
  (`*Alt`), the matched `productId` / `variantId`, and a quantity. Also
  `deliveryArea`, `deliveryChargeId`, `offered` (the quick-reply candidates
  for one item), `revision` (bumped by every card) and `quote` (the numbers
  the card with that revision showed). Phase 1's `productText` is gone; an
  old row parses as an empty list and the next turn asks again.
- **Extraction returns the whole list** (`packages/shared/src/schemas/llm.ts`,
  `llm/prompts/extract-order.ts`). Each entry carries `ref`, the index of the
  collected item it continues, or null for a new one; an item left out is
  removed. The prompt lists the collected items with the catalog's names
  beside the customer's own words (`customerWords`, `customerVariantWords`)
  and asks for the customer's words unchanged plus a transliteration, never a
  translation or a catalog name; an unchanged item may repeat either. It also returns `deliveryArea`.
- **`item-merge.ts`** (pure): `mergeItems` applies a returned list. A ref keeps
  its item's ids while its words are unchanged, words equal to the matched
  product's catalog name counting as unchanged; changed product words clear
  both ids, changed variant words clear the variant only; a bad or reused ref
  starts a new item. `mergeSameVariant` folds items on one variant together,
  quantities summed.
- **`catalog-match.ts`** (pure, in memory): `matchProduct`, `matchVariant`,
  `matchArea`. See [Matching](#matching).
- **`conversation-machine.ts`**: `decideTurn` takes the catalog, the delivery
  view and a trigger (a message the LLM read, or a pick). Slot order: per item
  `product`, `variant` (only when the product has more than one), `quantity`;
  then name, phone, address. A clear match fills the item; close candidates
  are offered as quick replies; nothing found, out of stock, a sold-out
  product, or a quantity above stock each ask again with a reason and count
  toward the three-ask hand-off. An out-of-stock variant is never offered.
  Once nothing is missing it quotes every line (`quoteFor`) and moves to
  `awaiting_confirmation` with `revision + 1`. `factsOf` gives the phrasing
  call catalog names and formatted prices, so `checkReply` rejects a price
  one unit off.
- **The summary card is code-built** (`summary-card.ts`): a fixed template per
  language, money through `formatMinorUnits` with `bn-BD` or `en-US`. It goes
  out as a button template with **Confirm** and **Change something**, whose
  payloads carry the conversation and the revision (`confirm:<id>:<n>`).
  When the text would pass Messenger's 640 characters, the item lines go out
  first as a plain message and the card keeps the totals and the customer's
  details.
- **`outgoing.ts`** turns a decision into Messenger messages: text, text with
  quick replies (`pick:product:<id>`, `pick:variant:<id>`), or the card. The
  turn stages each as a message row inside its transaction and delivers them
  in order after commit; once one is refused, the rest are marked failed
  unsent and the chat is handed off.
- **`order-confirmation.service.ts`**: see [Confirm](#confirm).
- **`OrdersService.createInTransaction`** (`orders/orders.service.ts`): the
  body of `create`, run inside the caller's transaction with an origin
  (`seller`, or `assistant` with its conversation) and a null actor for the
  assistant. `create` wraps it in `withMerchant` as before.
  `OrderableVariant` now carries `productActive`.
- **Messenger**: postbacks and quick-reply taps are stored as customer
  messages with their payload in `message.payload`
  ([Conversations](../../04-conversations/README.md)); a postback is queued
  with no delay. `MetaGraphClient` sends quick replies, button templates and
  images.

## Matching

`catalog-match.ts` normalises text (NFKC, lowercase, Latin digits,
punctuation to spaces, Bangla vowel signs kept) and scores the customer's
words and their transliteration against each product's name and aliases.
An exact match, or every word of one inside the other, scores 1. Otherwise
the score is the better of pg_trgm's similarity and (share of the name the
customer wrote) × (share of what they wrote that is the name), each word
allowed a misspelling at trigram similarity 0.4 or more. Words that name one
of the product's own option values ("red jamdani") are set aside first.
Variants score by the share of their option values the customer named.
Areas match the area the customer named, then an area named inside the
address, then everywhere else.

Thresholds (`MATCH_THRESHOLDS`) come from a sweep over the eval set, not by
hand: a clear winner scores at least 0.45 and leads the runner-up by 0.15;
candidates below 0.3 are not offered; at most three are. 0.45 is the lowest
value at which no case names a wrong product as the clear winner (at 0.4,
"face cream" became Sunscreen).

**Eval set** (`__tests__/fixtures/match-eval.ts`): a 16-product clothing and
cosmetics shop and 80 product messages (English, Bangla, Banglish,
misspellings, aliases, variant words mixed in, ambiguous, not sold) plus 14
variant phrases. Each case holds the query forms extraction should return.

| Set      | Score         | Misses                                                                                                                                        |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Products | 93.8% (75/80) | "burqa", "borkha chai", "kurtee": the right product as the only quick reply. "face cream", "baby shoes": a close product offered, not nothing |
| Variants | 100% (14/14)  | None                                                                                                                                          |

Every miss is a candidate offered, never a wrong product picked; the spec
asserts that. The cases' transliterations were written by hand, often as an
alias, so this measures the matcher given good query forms. The end-to-end
figure with the live model is `catalog-match.live-eval.spec.ts`, run by a
maintainer with `LLM_EVAL=1` and `LLM_API_KEY` set; it has not been run yet.

## Confirm

`OrderConfirmationService.run`, reached when the trigger's payload is a
Confirm or Change of ours. No LLM call; every reply is a fixed sentence per
language (`confirmText`). One short transaction:

1. Lock the conversation. A paused chat, a Page that is no longer the
   shop's, a payload naming another conversation, or a job for another
   merchant does nothing.
2. **Change** on the current card → `collecting_details`, `revision + 1`,
   "what would you like to change?". On any other card, the stale sentence.
3. **Confirm**: an order keyed `assistant:<conversationId>:<revision>` exists
   → resend its reference (a double tap, or two racing taps, make one order),
   unless a reply already follows this tap: then the run is a retry of the one
   that made the order, and it sends nothing.
   State not `awaiting_confirmation`, or another revision → the stale
   sentence.
4. Re-read every line's variant (`OrderCatalogRepository.findVariants`) and
   the fee (`DeliveryQuoteService.feeFor`). A line archived, short of stock,
   or whose product is no longer active → no order; that item loses its
   variant (and its product when the product left the catalog), the others
   stay, `collecting_details`, `revision + 1`, a sentence naming it. A unit
   price, the fee or the shop's currency changed → no order; a fresh card for
   `revision + 1`, in the shop's currency now, with a fixed "the price
   changed" line first.
5. Otherwise `createInTransaction` with the card's lines and fee, the slots'
   name, phone and address, cash on delivery; state `confirmed`; stage the
   reference.

After commit: send the reply, then `NotificationsService.orderDrafted` for
the card's order, whether this run made it or found it. Its queue job id is
`order-drafted-<orderId>`, so a repeat is a no-op while the first job is
kept (`EVENT_JOB_RETENTION`, seven days once completed); a retry after a
failed enqueue still emails. Lock order is conversation, then the
settings row; a seller-made order takes no conversation lock, so no cycle.

## Decisions

- **Multi-item orders.** The operator chose a list of items over a single
  line. Every shape is per item: the quote has `lines`, the card one line per
  item, Confirm re-reads every line.
- **A button template, not a generic one.** The generic template's 80
  characters per field cannot hold the items, totals and details; the photo
  goes out as its own image message.
- **The summary is never phrased.** No LLM writes a number on the card.
- **Matching is in memory**; `pg_trgm` in Postgres stays unneeded for the MVP.
- **A tap resolves by its payload's id**, never by re-matching its shortened
  title, and only when the last reply offered that id. A pick skips every
  LLM call, phrasing too; the fixed sentence answers it.
- **The delivery area rides on the address.** No separate area question. A
  complete order with no area match and no everywhere-else row hands off as
  `no_delivery_charge`.
- **A quote is pinned to its revision**, and Confirm creates an order only
  when every number still holds.
- **Stock is a yes/no fact.** Facts carry `inStock`, and `available` only when
  the customer asked for more. Stock does not move at Confirm; it moves when
  the seller confirms the order, as for every order.
- **An invalid phone is asked for again at once**, whatever slot would come
  next, as in phase 1.
- **Handing back a chat paused on a card retires the card.** The seller may
  have agreed other terms while holding it, so `ConversationsService.update`
  moves it to `collecting_details` with `revision + 1` and no quote, in the
  un-pause's transaction; the old card's Confirm is stale, and the
  customer's next message gets a fresh card.
- **A message after the card that changes nothing** hands off as
  `awaiting_seller`, as in phase 1; any change sends a new card.
- **The card's length is counted in code points**, stricter than graphemes,
  to match how the Graph client cuts text.
- **`ask_question` still hands off.** Answering delivery, payment and catalog
  questions from facts is unplanned.
- **The photo is not stored.** It is sent best effort before the reply and
  its echo is skipped as our own.

## Meta / App Review

`messaging_postbacks` was already in `PAGE_WEBHOOK_FIELDS`. No new permission.

## Rules it keeps

No order without the Confirm button; prices, variants, stock and delivery
charges only from the catalog and the shop's settings; order creation is
idempotent per card revision; nothing calls the LLM or Graph inside a
transaction. See the MVP [rules](../../../mvp/01-messenger-to-order/rules.md).

## Tests

Colocated in `apps/api/src/modules/conversations/assistant/__tests__/`.

| Spec                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog-match.spec.ts`              | pg_trgm's documented similarity; exact name, alias, misspelling, Banglish, Bangla; at most three candidates; none for what is not sold; only the given catalog matches; variants by value, out of stock still matched; area, address and fallback                                                                                                                                                                              |
| `catalog-match.eval.spec.ts`         | At least 90% on the eval set for products and variants, and no wrong product as a clear winner; prints the misses                                                                                                                                                                                                                                                                                                              |
| `catalog-match.live-eval.spec.ts`    | The same messages through the live extraction model (skipped unless `LLM_EVAL=1`)                                                                                                                                                                                                                                                                                                                                              |
| `item-merge.spec.ts`                 | Two products become two items; a ref keeps its ids, also when its words come back as the catalog name; changed words clear them; removal; bad and reused refs; same-variant merge                                                                                                                                                                                                                                              |
| `conversation-machine.spec.ts`       | Every state × intent; variant asked only with options; pick and refused pick; not found counts to the hand-off; out of stock; sold out; too many; "make the second one 3"; a catalog-name echo keeps the variant; removal; summary, revision, own charges, threshold, fallback; edit after the card; the photo                                                                                                                 |
| `reply-check.spec.ts`                | A price one unit off is rejected; the formatted price and total pass in Latin and Bangla digits                                                                                                                                                                                                                                                                                                                                |
| `summary-card.spec.ts`               | The card text per language, the notice line, and the split past 640 characters                                                                                                                                                                                                                                                                                                                                                 |
| `outgoing.spec.ts`                   | Quick-reply and card payloads; the item lines sent first for a long card                                                                                                                                                                                                                                                                                                                                                       |
| `assistant-fallbacks.spec.ts`        | A sentence per ask reason and per Confirm reply in both languages                                                                                                                                                                                                                                                                                                                                                              |
| `assistant-turn.service.spec.ts`     | (DB) The photo before the reply; candidates as quick replies and a tap filling the item with no LLM call; a tap never offered read as a message; the card's buttons carry its revision; a card tap routed to Confirm                                                                                                                                                                                                           |
| `order-confirmation.service.spec.ts` | (DB) One order with the card's numbers, the reference, `orderDrafted` after commit; double and racing taps; a retry after `orderDrafted` threw sends one reference and emails; stale card; paused; another conversation or merchant; one of three lines archived; product drafted; short stock; price changed; currency changed; Change; fee parity with `POST /orders/delivery-quote`; the old card refused after a hand-back |

Webhook postbacks and quick-reply payloads, and the three new Graph sends, are
covered in `messenger/__tests__/webhook-payload.spec.ts` and
`messenger/page/__tests__/meta-graph.client.spec.ts`.

## Follow-ups

- A native-speaker review of the Bangla card labels, ask sentences and
  Confirm sentences (`summary-card.ts`, `assistant-fallbacks.ts`).
- Run `catalog-match.live-eval.spec.ts` with the live model and record the
  end-to-end score here.
- A tap on a Confirm more than seven days after its order was made queues
  `orderDrafted` again once the first job has aged out, and emails the seller
  a second time.
- A deleted delivery area under a shown card sends the stale sentence and
  re-matches on the next message; it could send a fresh card at once.
- Showing the product photo in the dashboard thread.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test` pass.
- [x] Tapping Confirm twice creates one order (`order-confirmation.service.spec.ts`).
- [x] The eval set reaches the ≥ 90% product identification target from the
      [success metrics](../../../mvp/01-messenger-to-order/success-metrics.md),
      given the query forms.
- [ ] Manually, by the maintainer, with a real `LLM_API_KEY`: a conversation
      on the dev Page goes from "I want the red saree" to a `source = assistant`
      order with its reference sent back; it shows under the Drafted tab at
      `/orders` and the seller gets the email.
