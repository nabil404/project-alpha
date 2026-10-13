# 11.6 · Product photos

**Status:** not started ([progress](../progress.md)).

## Goal

A customer sends a photo or screenshot of a product ("do you have this?") and
the assistant finds candidates in the catalog. The customer always confirms
the match before it fills the product slot.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching and
quick-reply choices) and [phase 4](../phase-4-non-text-events/README.md)
(attachments stored with a `kind`).

## Scope

- **Input.** An `image` attachment. Download it from Meta's URL outside any
  transaction, with a size limit and timeout, and keep it in R2 so the seller
  can see it. Use a prefix other than `m/`: the orphan sweep deletes any
  object under `m/` without a `product_image` row
  ([Catalog](../../02-catalog/README.md#orphan-sweep)).
- **Candidates.** Send the image and a short list of the seller's active
  products (cover images and names, narrowed by category when the customer
  named one) to a vision model. Ask for at most three product ids from the
  list, with confidence, and discard any id not on it.
- **Confirm the match.** One candidate gets "Is it this one?" with its cover
  and Yes / No quick replies; several get a carousel; none or low confidence
  asks for the name, then hands off.
- **Screenshots** of another shop's post are treated as a product photo, and
  any price in them is ignored.
- **Cost.** Each vision call writes an `llm_call` row with purpose
  `vision_match`, which needs a new member in `LLM_CALL_PURPOSES` and a
  migration for `llm_call_purpose_ck`. A per-conversation cap (say three
  photos a turn) stops abuse.
- **Later, if accuracy falls short:** precomputed catalog image embeddings and
  a similarity search before the vision call.

## Meta / App Review

Nothing new; images arrive through `messages`.

## Rules it must keep

A photo match is a suggestion until the customer confirms it; price and stock
come from the catalog. Never call the model inside a transaction.

## Tests

- A product id not in the list is discarded.
- "No" to the suggestion asks for the name; a second miss hands off.
- A download timeout or oversize image gets a fixed reply, no crash.
- Another merchant's products never appear in the candidates.

## Done when

- [ ] On the dev Page, a photo of a catalog product gets "Is it this one?"
      with the right product in most tries on a small evaluation set (record
      the hit rate).
- [ ] Every photo shows in the conversation viewer.
