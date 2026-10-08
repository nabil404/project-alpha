# 07.2 · Catalog matching, Confirm and orders

**Status:** not started.

## Goal

The assistant finds the right product and variant in the seller's catalog,
quotes prices only from it, shows an order summary with a **Confirm** button,
and creates exactly one order when the customer taps it. This completes the
MVP's core flow.

## Depends on

[Phase 1](../phase-1-foundation/README.md): the assistant turn, the state
machine and phrased replies.

## Scope

- **Extraction returns raw words.** `extractOrder` returns `productQuery` and
  `variantQuery` as the customer wrote them, plus a transliteration into the
  catalog's script (Bangla, Banglish or English). The LLM never picks a product
  ID.
- **Matching in code.** Enable `pg_trgm` (via `db:custom`) and add trigram
  indexes on product name and aliases. Match only active products and their
  live variants, scoped by `merchantId`. One clear winner fills the slot; two or
  three close candidates become a quick-reply choice; none means asking again,
  then handing off. Product names in the prompt are held in reserve, depending
  on evaluation results.
- **Facts.** The matched product's price, variant, stock and delivery charge go
  into `facts`, so `checkReply` lets them through. Out of stock is a fact too:
  the assistant says so and never offers it.
- **Cover photo.** When a product is matched, send its cover image, or the
  variant's own image once a variant is picked.
- **Summary card.** In `awaiting_confirmation`, send a generic template with the
  items, quantity, delivery charge, total (via `formatMinorUnits`), name, phone
  and address, and two buttons: **Confirm** and **Change something**. The
  postback payload carries the conversation ID and a summary revision.
- **Confirm postback** (`messaging_postbacks`, already subscribed): queued like
  a message. In one transaction: lock the conversation, check the state is
  still `awaiting_confirmation` and the revision matches, decrement stock (and
  bump the product revision), create the order with a unique key on
  `(merchant_id, conversation_id, summary_revision)`, set state `confirmed`. A
  repeated tap finds the existing order and resends its ID.
- **Mid-flow edits.** "Make it 2" or "change the address" after the summary
  moves back to `collecting_details`, increments the revision, and sends a new
  card; the old Confirm button is then refused politely.
- **Order ID to customer** after confirmation; an email to the seller about the
  new order.
- **Order tables**: finalise the provisional `order` / `order_item` shape
  (snapshots of product name, variant name, unit price, delivery charge,
  customer contact) with RLS.

## Meta / App Review

`messaging_postbacks` is already in `PAGE_WEBHOOK_FIELDS`. No new permission.

## Rules it must keep

No order without the Confirm button; prices, variants, stock and delivery
charges only from the catalog; order creation is idempotent; stock changes bump
the product revision. See the MVP
[rules](../../../mvp/01-messenger-to-order/rules.md).

## Tests

- Matching: exact name, alias, misspelling, Banglish; inactive or archived
  products never match; another merchant's products never match.
- `checkReply` rejects a price that differs from the catalog by one unit.
- Confirm: double tap → one order; stale revision → refused; confirm after a
  seller takeover → refused; stock goes to zero in between → no order and a
  polite reply.
- Two-merchant isolation for orders and matching.

## Done when

- A conversation on the dev Page goes from "I want the red saree" to a
  confirmed order with its ID sent back, and the order shows in the API.
- Tapping Confirm twice creates one order.
- The evaluation set reaches the ≥90% product identification target from the
  [success metrics](../../../mvp/01-messenger-to-order/success-metrics.md).
