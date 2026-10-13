# 11.4 · Non-text events

**Status:** not started ([progress](../progress.md)). As of Oct 13, 2026 the
webhook keeps text messages and button taps; it drops attachments, stickers,
reactions and edits, and `message` has no `kind` column.

## Goal

Stickers, 👍, emoji, reactions, edited messages and shared locations are
handled instead of dropped. None of them can confirm an order.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md): the summary card and
Confirm, which these events must not bypass.

## Scope

- **Store and show.** Stickers, the 👍 sticker, emoji-only messages and
  reactions are stored as messages with a new `kind` (`text`, `sticker`,
  `reaction`, `location`, …) and shown in the conversation viewer.
- **Never a confirmation.** In `awaiting_confirmation`, a 👍, a ❤️ reaction or
  an "ok" sticker gets a short reply pointing to the Confirm button, and the
  state does not change.
- **No LLM call elsewhere.** An emoji-only or sticker message gets a fixed
  nudge from code; a reaction gets nothing.
- **Edits** (`message_edits`). The message keeps its original text and an
  edited copy. Before `awaiting_confirmation`, an edit to the latest customer
  message queues a new turn; after the card it never re-runs extraction, and
  the viewer shows "edited".
- **Unsend** marks the message deleted in the viewer; filled slots stay.
- **Location.** A shared location fills the address only if the customer
  agrees ("Deliver to this location?"), with the coordinates and a
  reverse-geocoded label. Without geocoding, ask for a written address and
  keep the pin for the seller.
- **Other attachments** (video, file, audio) are stored and shown. The
  assistant says it reads only text and photos, and hands off if the customer
  insists. Voice messages stay out of the MVP.

## Meta / App Review

Add `message_reactions` and `message_edits` to `PAGE_WEBHOOK_FIELDS` (check
the names against Meta's docs); connected Pages resubscribe. No new
permission.

## Rules it must keep

No order without the Confirm button. Every webhook is signature-verified and
deduplicated, reactions and edits included.

**Dedupe keys.** Reactions carry no new `mid`, and an edit reuses its
message's `mid`. Today the inbound job id is the `mid` and the turn's is
`turn-<mid>`, both kept an hour after completing, so an edit would be dropped
as a duplicate. Each event needs its own key, such as the `mid` plus the
event type and timestamp.

## Tests

- A 👍 sticker, a ❤️ reaction on the card, and an "ok" sticker in
  `awaiting_confirmation` create no order and point to the button.
- An edit before the card queues a new turn; after, none.
- A duplicate reaction webhook is stored once.
- A location without consent leaves the address empty.

## Done when

- [ ] Every event type above shows in the conversation viewer on the dev Page.
- [ ] An automated test proves none of them can create an order.
