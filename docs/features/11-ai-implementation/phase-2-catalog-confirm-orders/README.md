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
  beside the customer's earlier words (`customerWords`,
  `customerVariantWords`), so extraction can tell which item a message
  means, and asks for the customer's words unchanged plus a
  transliteration, never a translation or a catalog name. On an entry with
  a `ref`, `productQuery` is null unless the customer changed which product
  that item is, and then holds only the product they want now, never one
  they turned down ("not katan, jamdani" gives "jamdani"); `variantQuery`
  follows the same rule. It also returns `deliveryArea`.
- **`item-merge.ts`** (pure): `mergeItems` applies a returned list. A ref
  with null product words keeps its item's ids; any product words drop both
  ids and match from scratch, so an ambiguous echo asks again rather than
  keep a product; variant words likewise drop only the variant. Code never
  guesses whether new words still name the picked product. A bad or reused
  ref starts a new item. `mergeSameVariant` folds items on one variant
  together, quantities summed.
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
  language, money through `formatMinorUnitsTrimmed` (`@app/shared`) with
  `bn-BD` or `en-US`: the currency's decimals only when they are not zero,
  "৪,৫০০৳" but "১,৬০০.৫০৳". It goes
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
A clear winner becomes a choice beside every other product whose own name or
alias word the customer also wrote, misspelt or not, in any script, unless
the winner's own words cover that word too: "katan jamdni" and "কাতান না
জামদানী" ask, Katan or Jamdani. Words count as alike down to the candidate
floor (0.3), not the word threshold, because a one-letter slip in a short
name ("kuti" for "kurti") scores 0.375; a missed rival keeps a product the
customer may have turned down, an extra one only asks. When every script has
as many words, the forms are one text transliterated word by word, so a word
whose twin in the other script is the winner's is the winner's too: "কাতান
শাড়ি" with "katan shari" stays on the Katan, though "shari" is only the
Jamdani's alias. Trigrams miss a swap or a dropped letter in a short word
("lugni" for "lungi", "sat" for "set" is 0.14), and can call a rival's word
the winner's ("katha" is 0.33 like "katan"), so a word also names a rival
when it is within that rival's word by Elasticsearch's AUTO edit allowance
(optimal string alignment: none under 3 letters, one up to 5, two beyond;
letters are code points), unless the word is the winner's own, or one edit
from the winner's nearest word and strictly nearer it than any word the
winner does not share: "katan jmadni" and "kurti lugni" ask. Two edits from 6
letters, because "jmadni" is a swap and a dropped letter from "jamdani". An
equal distance is a choice: "kajan" is one edit from both "katan" and
"kajal", "katal" too, so either asks Katan or Kajal, while "sharee" stays
the winner's because "saree" is a word both sarees share. Only the winner's
exact word in the other script vouches for a twin here; "কাজন" is extraction's
transliteration of the same typo, so "kajan" with "কাজন" still asks. The sweep
applies the same rule.
Variants score by the share of their option values the customer named.
Areas match the area the customer named, then an area named inside the
address, then everywhere else.

Thresholds (`MATCH_THRESHOLDS`) come from a sweep over the eval set, not by
hand: a clear winner scores at least 0.45 and leads the runner-up by 0.15;
candidates below 0.3 are not offered; at most three are. 0.45 is the lowest
value at which no case names a wrong product as the clear winner (at 0.4,
"face cream" became Sunscreen). Rerun the sweep with
`MATCH_SWEEP=1 pnpm --filter api test catalog-match.sweep` (env loaded): it
prints every combination of the four thresholds over the eval set with its
identification rate, confident-wrong count and misses, the shipped constants
marked `*`.

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
   → resend its reference (a double tap, or two racing taps, make one order).
   When the assistant already replied to this tap, the run is a retry of the
   one that made the order: a reply marked sent means nothing more is sent;
   one `failed` (Graph refused it), or left `sending` for longer than
   `SEND_LEASE_SECONDS` (20 s; the worker died before recording the send),
   is delivered again from its stored row, with no new row, by the one run
   that claims it. The claim is a conditional update in this transaction
   (`MessageRepository.claimForResend`): it sets the row `sending` with a
   fresh `updated_at` only if it is still claimable, so of two retries only
   one gets the row back and sends; a row still inside its lease is left to
   the run sending it. A reply is this tap's when it comes after the tap and
   before the customer's next message, so a later reply to something else
   never counts as one.
   A refused claim, a row still inside its lease, throws
   `ReplyInFlightError`, so the job retries rather than finish with nothing
   sent: the run holding the lease either marks it sent, and the retry
   stops, or dies, and a retry past the lease claims it. The lease is
   stamped and compared with `clock_timestamp()`, the time of the claim, not
   `now()`, the start of a transaction that may have waited on the lock.
   State not `awaiting_confirmation`, another revision, or a quote of another
   revision → the stale sentence.
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
- **Money the customer reads drops zero decimals.** The card and the
  phrasing facts share one formatter, so a phrased reply may write a price
  as the card does; `checkReply` also accepts "৪,৫০০.০০" for "৪,৫০০", and
  holds "১,৬০০.৫০" to its paisa.
- **A switch is the extractor's call, not the matcher's.** Three fixes
  tried to tell "same product" from "switch" by reading the words on a
  picked item, and each missed a spelling. Now extraction returns product
  words on a picked item only for a switch, naming only the wanted product,
  and any words re-match from scratch; the rival guard covers an
  extraction that still carries both names. An extraction mistake does not
  always cost only a question. These paths end on a card that is wrong, and
  the card, which the customer reads before Confirm, is the last guard:
  - the extractor returns only the rejected product's words ("katan" for
    "not katan, jamdani"), which match it clear;
  - it misses a change and returns null words, which keep the old pick;
  - a wrong `ref` with variant words gives that variant to another item
    that has the same value;
  - an item it leaves out of the returned list is removed;
  - a new entry repeating an item that also has its `ref` lands on the same
    variant, and the two quantities are summed.
- **A redelivery is leased, not just checked.** Retries of one Confirm run
  serially under the conversation lock but send after commit, so a status
  read alone let two of them send the same stored reference. The claim needs
  a time to tell a send in flight from one whose worker died, and `message`
  had none to spare, so it gained `updated_at` rather than overloading
  `created_at`. The 20 s lease sits past the Graph call's 10 s timeout and
  short of the 30 s after which BullMQ reruns a job whose worker died. A
  retry the lease blocks throws to retry, since only a later run can tell a
  live sender from a dead one, so assistant turns back off from 3 s
  (`ASSISTANT_TURN_RETRY`, five attempts): at least 24 s follow any attempt
  but the last. The queue's default, 1 s over the same five, spends 15 s in
  all and would give up inside the lease.
- **Matching is in memory**; `pg_trgm` in Postgres stays unneeded for the MVP.
- **Matching is hand-written, not Fuse.js.** Measured by the lead on
  2026-10-11 against the same 80 product cases: Fuse 7.1.0 (keys name and
  aliases, `ignoreLocation`, the best score over both query forms) swept
  under the same one/lead/some rule identified 88.8% at its best setting
  with no confident-wrong match, against 93.8% for `catalog-match.ts` at
  `659c677`; Fuse reaches 93.8% only with 3 confident-wrong matches ("pink
  hijab" offered the Panjabi, for one). Fuse also scores a whole item,
  while the rival guard needs to know which product owns each customer
  word. The eval set was written while tuning the hand-written matcher, so
  it may favour it.
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
- **The ask counter follows its item.** When an edit removes or reorders
  items, `lastAsked` moves with the item it counted (by the extraction's
  `ref`, then by the same-variant merge); a removed item takes its count with
  it.
- **An invalid phone is asked for again at once**, whatever slot would come
  next, as in phase 1.
- **Handing back a chat paused on a card retires the card.** The seller may
  have agreed other terms while holding it, so `ConversationsService.update`
  moves it to `collecting_details` with `revision + 1` and no quote, in the
  un-pause's transaction; the old card's Confirm is stale, and the
  customer's next message gets a fresh card.
- **A turn that leaves the card without a new one retires it**, as Change
  does: an ask or a hand-off after the summary clears the quote and bumps
  the revision, so the old Confirm is stale on its revision and its quote,
  not only on the state.
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

| Spec                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog-match.spec.ts`              | pg_trgm's documented similarity; exact name, alias, misspelling, Banglish, Bangla; at most three candidates; another product's word beside a full name asks, misspelt or in either script ("katan na jamdni", "কাতান না জামদানী", "katan na kuti"), unless its twin in the other script is the winner's; a rival garbled past trigrams asks ("katan jmadni" in either script, "kurti lugni", "kurti sat" beside a Kurti Set), and for every pair of eval products A's name with B's word one swap, deletion, insertion or substitution off never names A clear; a typo as near two products ("kajan", "kajan"/"কাজন", "katal") offers both, and no single typo (drop, swap, change or add of a-z) of any Latin name or alias word, alone or beside its product's unchanged Bangla alias (about 29,700 queries), names another product clear; none for what is not sold; only the given catalog matches; variants by value, out of stock still matched; area, address and fallback                                                                                                              |
| `catalog-match.eval.spec.ts`         | At least 90% on the eval set for products and variants, and no wrong product as a clear winner; prints the misses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `catalog-match.live-eval.spec.ts`    | The same messages through the live extraction model (skipped unless `LLM_EVAL=1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `catalog-match.sweep.spec.ts`        | Not a check: the threshold sweep, printed (skipped unless `MATCH_SWEEP=1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `item-merge.spec.ts`                 | Two products become two items; a ref with null words keeps its ids; any product words, its own echoed or its catalog name, clear them; variant words, even unchanged, clear the variant; removal; bad and reused refs; same-variant merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `conversation-machine.spec.ts`       | Every state × intent; variant asked only with options; pick and refused pick; not found counts to the hand-off; out of stock; sold out; too many; "make the second one 3"; null product words keep the pick and its variant; "jamdani" or "জামদানী" alone on a picked Katan pick the Jamdani, "jamdni" offers it; an echoed "saree" or "red saree", "katan na jamdni dao", "katan na, jamdni" and "কাতান না জামদানী" ask rather than keep the Katan Saree; "kurti" on a picked Kurti Set asks Kurti or Kurti Set; "not katan, jamdani", "jamdani instead of katan" and "check shirt" let the product go, and so do "not the A, the B", "B instead of A" and "A na B" (with its Bangla form, either way round) for every pair of eval products, B exact or with one letter dropped, its Bangla with either i-vowel sign; removal; the ask counter after a removal; summary, revision, own charges, threshold, fallback; edit after the card; an ask or a hand-off after the card clears the quote and bumps the revision; the photo                                                             |
| `reply-check.spec.ts`                | A price one unit off is rejected; the formatted price and total pass in Latin and Bangla digits; a price with paisa is held to its paisa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `summary-card.spec.ts`               | The card text per language, the notice line, and the split past 640 characters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `outgoing.spec.ts`                   | Quick-reply and card payloads; the item lines sent first for a long card                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `assistant-fallbacks.spec.ts`        | A sentence per ask reason and per Confirm reply in both languages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `assistant-turn.service.spec.ts`     | (DB) The photo before the reply; candidates as quick replies and a tap filling the item with no LLM call; a tap never offered read as a message; the card's buttons carry its revision; a card tap routed to Confirm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `order-confirmation.service.spec.ts` | (DB) One order with the card's numbers, the reference, `orderDrafted` after commit; double and racing taps; a reference refused by Graph, or left `sending` by a crash past the lease, delivered once from its stored row on the retry; a retry that finds a reference still inside its lease throws and sends nothing, and the retry past the lease sends it once; of two concurrent retries over one stored reference one sends and the other throws; a second tap gets the reference though a customer message and a sent reply landed after it before its turn ran; a fee-only change (area charge, free-delivery threshold); a retry after `orderDrafted` threw sends one reference and emails; stale card; paused; another conversation or merchant; one of three lines archived; product drafted; short stock; price changed; currency changed; Change; fee parity with `POST /orders/delivery-quote`; the old card refused after a hand-back; a Confirm refused when the chat left `awaiting_confirmation` with its quote stored, and when the stored quote is older than the revision |

**Conversation simulator** (`conversation-simulator.spec.ts`, harness in
`__tests__/simulator/`): plays a scripted Messenger conversation through the
worker's own code against the local database. Each step is a signed webhook
body for `MessengerController`; its jobs run in process through
`InboundMessageProcessor` and `AssistantTurnProcessor` (Confirm included),
with no Redis and no HTTP server, and every Graph send lands in a fake client
whose echoes come back as Meta sends them. It prints, per step, the
customer's input, each message sent, the state, the slots and any order
created. Scenarios: the golden path ("I want the red saree and 2 blue
kurtis", a quick-reply pick, quantity, name, phone, address, the card,
Confirm twice: one order, the same reference), "make the saree 3" after
the card with no product words from extraction (the pick kept, a new card;
the old one refused), the same message with "saree" echoed (Jamdani or Katan
asked, the pick not kept, the old card's Confirm refused) and "not katan, jamdani" after the card (Katan or
Jamdani asked, the Jamdani picked, a card with the Jamdani and
no Katan). Run it with the scripted model:
`pnpm --filter api test conversation-simulator` (env loaded). With the live
model: `LLM_EVAL=1` and `LLM_API_KEY` set; the script's model answers are then
ignored, phrasing is live, and a turn may legitimately differ from the
script, so read the transcript when an assertion fails.

Outside that folder, `conversations/__tests__/message-claim.spec.ts` (DB)
proves `claimForResend` stamps and measures the lease at the claim, not at
its transaction's start, and never claims another merchant's row on a
connection that could see it; `queue/__tests__/assistant-turn-retry.spec.ts`
proves `ASSISTANT_TURN_RETRY` waits out the lease after any attempt but the
last, through BullMQ's own backoff calculation.

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
- No `conversations.service` spec covers the inbox echo that pauses the
  assistant before a hand-back retires the card.
- A Confirm send that is still in flight after the 20 s lease (a worker
  stalled, not dead, past the Graph timeout) can be sent again by a rerun of
  its job. A run that dies on the job's last attempt leaves its reference
  unsent; the customer's next tap sends it.
- A freshly staged reply's `updated_at` is the column default, `now()`, the
  start of the staging transaction, so its lease is short by however long
  that transaction ran, lock wait included.
- A redelivered row goes out as plain text: only the text reference can be
  redelivered today, since the stored row keeps no quick replies or buttons.
- `checkReply` joins digit runs across separators, so a reply's "1.20" can
  match a fact "120" (pre-existing).
- A deleted delivery area under a shown card sends the stale sentence and
  re-matches on the next message; it could send a fresh card at once.
- Showing the product photo in the dashboard thread.
- `checkReply` checks the digits in a phrased reply; a number spelled out
  ("two hundred") is not compared with the facts.
- The 640-character cut (`cutText` in `meta-graph.client.ts`) counts code
  points, never splitting a grapheme. Check it against how Messenger counts
  before loosening it to graphemes.
- A postback without a `mid` gets an id hashed from its sender, timestamp
  and payload; with no timestamp either, the clock is used and a redelivery
  is not deduplicated.

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
