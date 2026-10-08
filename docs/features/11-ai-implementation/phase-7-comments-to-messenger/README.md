# 11.7 · Comments to Messenger

**Status:** not started.

## Goal

A comment on a Page post, ad or reel ("price?", "PM", "interested") gets one
private reply in Messenger that starts the order conversation, plus an optional
short public reply so other readers see the shop answered.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching and orders)
and [phase 5](../phase-5-shared-posts/README.md) (`product_post`: which product
a post is about).

## Scope

- **Webhook.** Subscribe `feed`; keep only `item = comment`, `verb = add` on the
  Page's own posts, ads and reels. Ignore the Page's own comments and replies to
  them. Dedupe on `comment_id`.
- **Classify.** The routing model decides whether the comment shows buying
  interest. Complaints and abuse are stored for the seller, never answered
  automatically.
- **Private reply.** Send API with `recipient: { comment_id }`: one message per
  comment, within Meta's time limit (check the current window). It names the
  product when the post is linked ("Hi! You asked about the Jamdani Saree…") and
  creates the conversation, linked to the comment, so the customer's answer
  continues in the normal flow.
- **Public reply** (optional, per shop, off by default): a short fixed sentence
  in the shop's language, such as "Sent you a message 📩". It never contains a
  price, stock, a name, a phone number or an address.
- **Settings.** Per shop: comment replies on/off, public reply on/off, and per
  post an opt-out (for example a giveaway post).
- **Dashboard.** A comment list per post showing whether it was answered, with
  a link to the conversation it started.
- **Rate limits.** A queue with concurrency limits per Page, so a viral post
  does not exhaust Graph's limits; failures retry with backoff and then appear
  in Needs Attention.

## Meta / App Review

`feed` webhook; `pages_read_user_content` (read comments) and
`pages_manage_engagement` (public reply), both in the Week 4 App Review. The
private reply uses `pages_messaging`. Check permission names and the private
reply window against Meta's current docs.

## Rules it must keep

Public replies never carry prices or customer data. Webhooks are verified and
deduplicated. A comment is never an order confirmation.

## Tests

- The same comment webhook twice → one private reply.
- The Page's own comment → ignored.
- A public reply template containing a digit or a price → rejected by a check.
- Shop setting off → nothing sent; post opt-out → nothing sent.
- Two-merchant isolation for comments.

## Done when

- A comment on a dev Page post produces one private reply and, if enabled, one
  public reply, and the reply leads to a confirmed order.
