# 11.4 · Non-text events

**Status:** not started.

## Goal

Stickers, 👍, emoji, reactions, edited messages and shared locations are handled
safely instead of being dropped. None of them can ever confirm an order.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md): the summary and Confirm
flow, which these events must not bypass.

## Scope

- **Store and show.** Stickers, the like (👍) sticker, emoji-only messages and
  reactions are stored as messages with a `kind` (`text`, `sticker`, `reaction`,
  `location`, …) and shown in the conversation viewer. Today the webhook keeps
  text only.
- **Never a confirmation.** In `awaiting_confirmation`, a 👍, a ❤️ reaction or an
  "ok" sticker gets a short reply pointing to the Confirm button. The state does
  not change.
- **Elsewhere**, an emoji-only or sticker message runs no LLM call: code answers
  with a fixed nudge (or nothing, for a reaction) so it costs nothing.
- **Edits** (`message_edits`): the stored message keeps its original text and an
  edited copy. Before `awaiting_confirmation`, an edit to the latest customer
  message queues a new turn. After the summary or after confirmation it never
  re-runs extraction; the seller sees "edited" in the viewer.
- **Unsend.** The message is marked deleted in the viewer; slots already filled
  stay.
- **Location.** A shared location fills the address slot with the coordinates
  and a reverse-geocoded label only if the customer agrees ("Deliver to this
  location?"). Without geocoding, ask for a written address and keep the pin
  for the seller.
- **Other attachments** (video, file, audio): stored and shown; the assistant
  says it can only read text and photos, and hands off if the customer insists.
  Voice messages stay out of the MVP.

## Meta / App Review

Subscribe `message_reactions` and `message_edits` (add to
`PAGE_WEBHOOK_FIELDS`; check the field names against Meta's current docs). No new
permission.

## Rules it must keep

No order without the Confirm button. Every webhook is signature-verified and
deduplicated, reactions and edits included (their own dedupe key, since they
have no new `mid`).

## Tests

- A 👍 sticker, a ❤️ reaction on the summary, and "ok" as a sticker in
  `awaiting_confirmation` → no order, a pointer to the button.
- An edit before the summary → new turn; after → no turn.
- A duplicate reaction webhook → stored once.
- Location without consent → address slot stays empty.

## Done when

- Every event type above is visible in the conversation viewer on the dev Page.
- An automated test proves that none of them can create an order.
