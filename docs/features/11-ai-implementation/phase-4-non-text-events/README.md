# 11.4 · Non-text events

**Status:** built (Oct 2026). Seeing each event type in the conversation
viewer on the dev Page is still to do ([Done when](#done-when),
[progress](../progress.md)).

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

## What is built

### Webhook

`parseInboundJobs()` in
[`webhook-payload.ts`](../../../../apps/api/src/modules/messenger/webhook-payload.ts)
maps each event to a job. Every job id is its own, because the controller
uses it as the BullMQ job id and the ingest stores it as `meta_message_id`:

| Event                                  | Job                                                       | Id                                                         |
| -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `message` with attachments and no text | `customer-message`, `text: ''`, `attachments`             | the `mid`                                                  |
| `reaction` (`react` or `unreact`)      | `customer-reaction` with `targetMid`, `emoji`, `reaction` | `rx-` + hash of sender, target, action, emoji, label, time |
| `message_edit`                         | `customer-edit` with `targetMid` and the new `text`       | `ed-` + hash of `mid`, `num_edit`, time                    |
| `message` with `is_deleted: true`      | `customer-unsend` with `targetMid`                        | `un-<mid>`                                                 |

- **Attachments.** `sticker` (also an `image` carrying `sticker_id`, from
  older clients), `location` with `payload.coordinates`, and `image`,
  `video`, `audio`, `file`. A `post`, `share` or `fallback` that carries a
  link or a post id is a shared post
  ([phase 5](../phase-5-shared-posts/README.md)). Any other type (`reel`, a
  fallback with no payload, …) is `other`.
- A reaction or edit whose sender is the Page itself makes no job. An echo
  without text still makes none.
- **Unsend is undocumented for Messenger.** Meta's `messages` reference lists
  no `is_deleted`; Instagram uses it, so Messenger is read the same way if it
  ever sends one.

### Ingest

[`inbound-message.ingest.ts`](../../../../apps/api/src/modules/conversations/ingest/inbound-message.ingest.ts)
routes edits, unsends and reaction removals to their own short transactions
and stores everything else as a new row:

- **New rows.** A non-text message stores its `kind` and `details`, and no
  words in any language: `text` is the emoji for a reaction, `👍` for the
  Like sticker (ids in `LIKE_STICKER_IDS`), and empty otherwise. The
  conversation's `last_message_kind` records it for the list.
- **Reactions** resolve their target `mid` to our row when we have it. A
  reaction moves the list columns but not `last_inbound_at`: it is not a
  message, so it neither opens the reply window nor marks the chat unread. It
  queues a turn only in `awaiting_confirmation`. `unreact` sets `deleted_at`
  on the customer's newest standing reaction to that `mid`.
- **Confirmed chats.** A reaction, a sticker or an emoji-only message does not
  start the next order; words, a photo or a file still do.
- **Edits** set `edited_text` and `edited_at` on the target, only when newer
  than the stored edit, so a redelivery is a `duplicate`. The edit must come
  from the customer the message belongs to (`unknown-target` otherwise). In
  `browsing` or `collecting_details` it queues a turn with job id
  `turn-ed-…`; in any later state it queues nothing.
- **Unsends** set `deleted_at`. Collected slots are left as they are.

### Turn

[`non-text-turn.ts`](../../../../apps/api/src/modules/conversations/assistant/non-text-turn.ts)
holds `decideNonText()`, a pure function the turn calls before any LLM call.
Its fixed lines are `notice` replies in `assistant-fallbacks.ts`, which change
neither the state nor the slots:

| Trigger                   | `awaiting_confirmation`                                                           | Before the card                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Words                     | the LLM, as before                                                                | the LLM, as before                                                                                 |
| Reaction                  | `use_confirm` if it reads as a yes (`like`, `love`, 👍 ❤️ 😍 🥰 👌), else nothing | nothing (`silent`)                                                                                 |
| Sticker, emoji-only text  | `use_confirm`                                                                     | `type_please`                                                                                      |
| Location                  | `use_confirm`                                                                     | `location_write_address`, or `location_seen` once an address is collected                          |
| Photo                     | `use_confirm`                                                                     | left to the turn, which matches it to the catalog ([phase 6](../phase-6-product-photos/README.md)) |
| Video, audio, file, other | `use_confirm`                                                                     | `text_only`; a second in a row hands off (`unreadable`)                                            |

- **The gate.** `turnGate()` reads a message's `kind` and `edited_at`. A
  reaction never makes a message's turn stale (only a newer reaction makes a
  reaction's stale), and a reply answers a trigger only if it is newer than
  `askedAt()`: the latest edit, else the send time. An edit before the card
  therefore runs the turn again.
- **History.** `toChatLines()` leaves reactions out, reads an edited message
  as its edit in its original place, and reads a message without words as a
  fixed English tag from `chatText()` (`[sent a sticker]`, `[shared a
location]`, …), which no one else sees.

### Data

Migration `0041_message_kind` adds to `message`: `kind` (default `text`, with
`message_kind_ck`), `details` (jsonb, parsed with `messageDetailsSchema` in
`message-content.ts`), `edited_text`, `edited_at` and `deleted_at`. The
`Message` DTO gains `kind`, `attachments` (only `https` links reach the
browser), `location`, `reaction` (`emoji` and our target id), `editedText` and
`deleted`. Migration `0042_conversation_last_message_kind` adds
`conversation.last_message_kind` (default `text`, with
`conversation_last_kind_ck`); `LastMessage`, shared by the conversation list
and the customer's latest conversation, gains `kind`.

### Dashboard

`MessageList.tsx` renders each kind: stickers without a bubble, photos,
video and audio inline, files as links, a location with its coordinates and
an OpenStreetMap link. A reaction is a pill on the bottom corner of the
message it answers, as in Messenger (`placeReactions()`): only the newest
standing reaction per message shows, a taken-back one disappears, and one
whose message is not loaded (or was never stored) stays a line. An edited
message shows its edit, "Edited" and the original; an unsent one is struck
through and marked "Unsent". What a wordless message says ("Sent a sticker",
"Reacted 👍", …) comes from `messageContent()` in `status-keys.ts` and
`status.messageContent.*` in `common.json`, so it follows the seller's chosen
language (Account › Preferences); the thread, the conversation list and the
customer's latest-conversation card all use it.

## Decisions

- **No geocoding, so no consent question.** No geocoding provider is
  configured, so a pin never fills the address: the assistant asks for a
  written one and the seller sees the pin. The "Deliver to this location?"
  consent flow is not built ([Follow-ups](#follow-ups)).
- **A photo hands off** until [phase 6](../phase-6-product-photos/README.md),
  which now matches it to the catalog before the card.
- **A file twice in a row is "insisting".** Simple to read from the thread,
  and it needs no counter in the slots.
- **No words stored for non-text messages.** The language is each seller's
  own setting, and the webhook has no seller to ask, so a label written at
  ingest would be in the wrong language for some readers. The dashboard names
  the kind instead. Search does not find these messages by their label.

## Meta / App Review

`PAGE_WEBHOOK_FIELDS` adds `message_reactions` and `message_edits`, the names
in Meta's webhook reference. No new permission. Connected Pages are
re-subscribed by the worker's one-off job, now `resubscribe-pages-v2`
([Meta setup](../../../setup/meta-setup.md)).

## Rules it must keep

No order without the Confirm button. Every webhook is signature-verified and
deduplicated, reactions and edits included.

**Dedupe keys.** Reactions carry no new `mid`, and an edit reuses its
message's `mid`. Each event's job id is derived as in the [Webhook](#webhook)
table, and the turn's is `turn-` plus that id, so an edit is never dropped as
its message's duplicate.

## Tests

- **`webhook-payload.spec.ts`**: a sticker (as an image with `sticker_id`),
  a location, a video and a reel; a message with nothing is dropped; a
  reaction's id repeats on redelivery and changes for a new reaction; an edit
  and an unsend get their own keys; the Page's own reaction makes no job.
- **`non-text-turn.spec.ts`**: every non-text trigger on the card gets
  `use_confirm` with the state and slots unchanged; a sad reaction and a
  reaction before the card are `silent`; stickers and emoji get
  `type_please`; a pin never fills the address; a second file hands off;
  `isEmojiOnly` on flags, skin tones, joiners, digits and Bangla.
- **`turn-gate.spec.ts`**: a reaction does not make a message's turn stale;
  an edit makes an answered message askable again.
- **`inbound-message.ingest.spec.ts`** (DB): a sticker's kind, label and link;
  the 👍 sticker; a duplicate reaction webhook stored once, with no turn and
  no change to `last_inbound_at`; a reaction on the card queues a turn;
  unreact; an edit kept beside the original, queued once before the card and
  never after; an edit from another customer; an unsend that keeps the
  slots; a confirmed chat stays confirmed for a sticker, a reaction or 🙏.
- **`assistant-turn.service.spec.ts`** (DB): on the summary card, the 👍
  sticker, an "ok" sticker, a ❤️ reaction, a typed 👍, a location, a photo,
  a video and a file each send only the Confirm pointer, make no LLM call,
  never reach the confirmation service and create no order. A reaction before
  the card is silent; a sticker gets the fixed nudge; an edited message is
  read as its edit and answered again.
- `apps/web` has no test runner; the viewer is covered by `typecheck` and
  `lint` only.

## Follow-ups

- Look at each kind in the conversation viewer on the dev Page. Only the
  reaction pills were checked in a browser (desktop and 375 px, against
  stubbed API responses); the other kinds were not.
- The location consent flow ("Deliver to this location?", Yes / No) with a
  reverse-geocoded label, once a geocoding provider is chosen.
- Whether Messenger sends unsends at all, and in what shape; check on the dev
  Page.
- Meta's attachment links expire. Photos are copied to R2
  ([phase 6](../phase-6-product-photos/README.md#copying-the-photo)); stickers,
  video, audio and files are not.
- A seller's own sticker or photo from Facebook's inbox is still dropped, and
  so does not pause the assistant.
- A native-speaker review of the Bangla notices.
- A standalone referral still stores its line ("Opened a link to a product")
  in the shop country's language (`REFERRAL_TEXT`), not the seller's; it
  could become a kind the dashboard names, as non-text messages are.

## Done when

- [x] `pnpm --filter @app/shared build && pnpm typecheck && pnpm lint && pnpm test`
      pass (last run Oct 15, 2026), the new suites ran against the database,
      and `db:verify-rls` passes after migrations `0041` and `0042`.
- [ ] Every event type above shows in the conversation viewer on the dev Page.
- [x] An automated test proves none of them can create an order
      (`assistant-turn.service.spec.ts`, "messages without words").
