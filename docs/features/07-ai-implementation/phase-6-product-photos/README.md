# 07.6 · Product photos

**Status:** not started.

## Goal

A customer sends a photo or screenshot of a product ("do you have this?") and
the assistant finds candidates in the seller's catalog. The customer always
confirms the match before it fills the product slot.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching, quick-reply
choices) and [phase 4](../phase-4-non-text-events/README.md) (attachments stored
with a `kind`).

## Scope

- **Input.** An `image` attachment from the webhook. Download it from Meta's URL
  outside any transaction, with a size limit and a timeout, and keep it in R2
  under the merchant's prefix so the seller can see it later.
- **Candidates.** Send the customer's image plus a short list of the seller's
  active products to a vision-capable model. Start simple: product cover images
  and names, narrowed by category when the customer named one. Ask for at most
  three product IDs from that list, with confidence. IDs outside the list are
  discarded.
- **Confirm the match.** One candidate → "Is it this one?" with its cover image
  and Yes / No quick replies. Several → a carousel to choose from. None or low
  confidence → ask for the product name, then hand off.
- **Screenshots** of another shop's post or a price are treated as a photo of the
  product; any price in the screenshot is ignored.
- **Cost.** Each vision call writes an `llm_call` row (purpose `vision_match`).
  A per-conversation cap (for example three photos a turn) stops abuse.
- **Later, if accuracy is short:** precomputed image embeddings of the seller's
  catalog with a similarity search before the vision call. Not in the first
  version.

## Meta / App Review

None new; the image arrives through `messages`.

## Rules it must keep

The AI never invents availability: a photo match is a suggestion until the
customer confirms it, and price and stock come from the catalog. Never call the
model inside a transaction.

## Tests

- A model reply naming a product ID not in the list is discarded.
- "No" to the suggestion → asks for the name; a second miss → hand-off.
- Image download timeout or oversize → fixed reply, no crash.
- Another merchant's products never appear in the candidate list.

## Done when

- On the dev Page, a photo of a catalog product gets "Is it this one?" with the
  right product in most tries on a small evaluation set (record the hit rate).
- Every photo shows in the conversation viewer.
