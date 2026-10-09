# 11.2 · Catalog matching, Confirm and orders

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

- **Resolves phase 1's words.** `collected_slots.productText` / `variantText`
  become `productId` / `variantId`; the variant is asked for only when the
  matched product has options. Owns the open gap: `ask_question` still hands
  off in every phase; answering delivery, payment and catalog questions from
  facts is unplanned.
- **Extraction returns raw words.** `extractOrder` returns `productQuery` and
  `variantQuery` as the customer wrote them, plus a transliteration into the
  catalog's script (Bangla, Banglish or English). The LLM never picks a product
  ID.
- **Matching in code** over `ProductsService.findSellableCatalog(merchantId)`,
  the AI's catalog read, which already returns only active products and live
  variants ([Catalog](../../02-catalog/README.md)). Fuzzy matching on name and
  aliases (`pg_trgm` via `db:custom` if an in-memory match is not enough). One
  clear winner fills the slot; two or three close candidates become a
  quick-reply choice; none means asking again, then handing off. Product names
  in the prompt are held in reserve, depending on evaluation results.
- **Facts.** The matched variant's price and stock go into `facts`, so
  `checkReply` lets them through. Out of stock is a fact too: the assistant
  says so and never offers it.
- **Delivery area and fee.** Ask for the area along with the address and match
  it to the shop's delivery areas ("Everywhere else" when none matches). The
  fee comes from `deliveryFeeFor` in `@app/shared`, the same rule the
  dashboard's `POST /orders/delivery-quote` uses
  ([Settings – Delivery charges](../../09-settings-delivery/README.md)),
  including per-product charges and the free-delivery threshold.
- **Cover photo.** When a product is matched, send its cover image, or the
  variant's own image once a variant is picked.
- **Summary card.** In `awaiting_confirmation`, send a generic template with the
  items, quantity, delivery fee, total (via `formatMinorUnits`), name, phone
  and address, and two buttons: **Confirm** and **Change something**. The
  postback payload carries the conversation ID and a summary revision.
- **Confirm postback** (`messaging_postbacks`, already subscribed): queued like
  a message. In one short transaction: lock the conversation, check the state
  is still `awaiting_confirmation` and the revision matches, create the order
  through the existing orders code with `source = assistant`, status `new`
  (shown as "Drafted") and the conversation's `conversation_id`, and set state
  `confirmed`. Idempotent per confirmation: a key on the conversation and the
  summary revision, so a repeated tap finds the existing order and resends its
  reference. Stock is not touched here: it moves when the seller confirms the
  order, as for every order ([Orders](../../07-orders/README.md)).
- **After commit:** send the order reference (`ORD-2026-00481`) through the
  shared send path, and call `NotificationsService.orderDrafted(merchantId,
orderId)` so the seller gets the new-order email
  ([Settings – Notifications](../../10-settings-notifications/README.md#sending)).
  This closes the assistant items in the
  [Orders follow-ups](../../07-orders/README.md#follow-ups).
- **Mid-flow edits.** "Make it 2" or "change the address" after the summary
  moves back to `collecting_details`, increments the revision, and sends a new
  card; the old Confirm button is then refused politely.

## Meta / App Review

`messaging_postbacks` is already in `PAGE_WEBHOOK_FIELDS`. No new permission.

## Rules it must keep

No order without the Confirm button; prices, variants, stock and delivery
charges only from the catalog and the shop's delivery settings; order creation
is idempotent; nothing calls the LLM or Graph inside the order transaction. See the MVP
[rules](../../../mvp/01-messenger-to-order/rules.md).

## Tests

- Matching: exact name, alias, misspelling, Banglish; inactive or archived
  products never match; another merchant's products never match.
- `checkReply` rejects a price that differs from the catalog by one unit.
- Confirm: double tap → one order; stale revision → refused; confirm after a
  seller takeover → refused; the variant archived in between → no order and a
  polite reply.
- The fee on the summary equals `POST /orders/delivery-quote` for the same
  items and area, free-delivery threshold included.
- `orderDrafted` is called once per order, after commit.
- Two-merchant isolation for orders and matching.

## Done when

- A conversation on the dev Page goes from "I want the red saree" to a
  `source = assistant` order with its reference sent back; it shows under the
  Drafted tab at `/orders` and the seller gets the email.
- Tapping Confirm twice creates one order.
- The evaluation set reaches the ≥90% product identification target from the
  [success metrics](../../../mvp/01-messenger-to-order/success-metrics.md).
