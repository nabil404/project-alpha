# 07 · AI implementation

How the assistant turns customer activity on a Page into confirmed orders. Scope
comes from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and is
bound by its [rules](../../mvp/01-messenger-to-order/rules.md). This page is the
index; each phase has its own page with goal, scope, tests and a definition of
done.

**Status (Oct 2026):** not started. Inbound text messages and seller echoes are
stored ([04 · Conversations](../04-conversations/README.md)); nothing writes
`sender = assistant` yet.

## Phases

Phases are built in order, each as its own PR. The order runs from the MVP's
core to the riskiest additions: a later phase may assume every earlier one has
shipped.

| #   | Phase                                                                         | What it adds                                                                                                            | Meta impact                                                  |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | [Foundation](phase-1-foundation/README.md)                                    | Assistant-turn job, LLM client, state machine, phrased replies with a fact check, hand-off                              | None                                                         |
| 2   | [Catalog matching, Confirm, orders](phase-2-catalog-confirm-orders/README.md) | Product and variant matching in code, summary card with a Confirm button, idempotent order creation                     | `messaging_postbacks` (already subscribed)                   |
| 3   | [Entry points](phase-3-entry-points/README.md)                                | Get Started, ice breakers, persistent menu, quick-reply browsing, `m.me` / QR links per product, click-to-Messenger ads | `messaging_referrals`; Messenger Profile API                 |
| 4   | [Non-text events](phase-4-non-text-events/README.md)                          | Reactions, stickers and 👍 stored but never a confirmation; message edits; shared location fills the address            | `message_reactions`, `message_edits`                         |
| 5   | [Shared posts and ads](phase-5-shared-posts/README.md)                        | A post or ad shared into the chat resolves to a product; sellers link posts to products                                 | `messaging_referrals`; `pages_read_engagement`               |
| 6   | [Product photos](phase-6-product-photos/README.md)                            | A customer's photo or screenshot returns candidate products; the customer always confirms the match                     | None (LLM provider)                                          |
| 7   | [Comments to Messenger](phase-7-comments-to-messenger/README.md)              | A comment on a post, ad or reel gets one private reply that opens the chat, plus an optional public reply               | `feed`; `pages_manage_engagement`, `pages_read_user_content` |
| 8   | [Live-sale comments](phase-8-live-sale-comments/README.md)                    | Order codes in Facebook Live comments, a private reply per buyer, rate limiting and dedupe                              | As phase 7                                                   |
| 9   | [Mentions and visitor posts](phase-9-mentions-visitor-posts/README.md)        | Listed in the dashboard for the seller; no auto-reply                                                                   | `mention`, `feed`; `pages_read_user_content`                 |

## Principles every phase keeps

- **Code decides, the LLM phrases.** The LLM classifies, extracts raw words and
  writes sentences. Code matches products, fills slots, moves the conversation
  state, and checks every number in a reply against catalog facts.
- **Only the Confirm button confirms.** A reaction, sticker, emoji, comment,
  edit, photo or shared post is never an order confirmation.
- **Never in a transaction.** LLM, vision and Graph calls happen outside any
  database transaction; a short transaction re-checks state and writes.
- **Always a reply.** Any failure ends in a fixed fallback sentence and a
  hand-off, never silence.
- **Nothing public is private.** Public comment replies never carry prices,
  stock, names, phone numbers or addresses.

## App Review

App Review is submitted by the end of Week 4 (around Oct 18). Every new
permission goes into that one submission alongside `pages_messaging`, each
with its own screencast:

| Permission                | Needed by     | Screencast shows                                             |
| ------------------------- | ------------- | ------------------------------------------------------------ |
| `pages_messaging`         | Phases 1–6    | A customer message answered and an order confirmed           |
| `pages_read_engagement`   | Phases 5, 7–9 | The post picker on the product page; a shared post resolved  |
| `pages_manage_engagement` | Phases 7, 8   | A comment answered with a private and a public reply         |
| `pages_read_user_content` | Phases 7–9    | Comments, mentions and visitor posts listed in the dashboard |

Check the exact permission names and webhook fields against Meta's current
documentation before submitting. A rejection drops only the phases that need
that permission; Pages connected earlier must reconnect to grant new ones.

**Known conflict:** the screencasts for phases 5 and 7 need those features
working on the dev Page before the sequential plan reaches them. Either build a
minimal post picker and comment reply ahead of order for the recording, or
request those permissions in a second review round after the features land.

## Timeline and cuts

Nine phases for one developer by Dec 11. If the schedule slips, cut from the
bottom: phase 9, then 8, then 7. Phases 1 and 2 are the MVP's core flow and
cannot be cut.

## Future improvements (not MVP)

Voice messages, Page reviews and recommendations, Lead Ad forms, post reaction
analytics. They are listed in the MVP's
[backlog](../../mvp/01-messenger-to-order/scope.md#out-of-scope-post-mvp-backlog).
