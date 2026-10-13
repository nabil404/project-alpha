# 11.7 · Comments to Messenger

**Status:** not started ([progress](../progress.md)).

## Goal

A comment on a Page post, ad or reel ("price?", "PM", "interested") gets one
private reply in Messenger that starts the order conversation, plus an
optional short public reply so other readers see the shop answered.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching and orders)
and [phase 5](../phase-5-shared-posts/README.md) (`product_post`, which
product a post is about).

## Scope

- **Webhook.** Subscribe `feed` and keep only `item = comment`, `verb = add` on
  the Page's own posts, ads and reels, ignoring the Page's own comments and
  replies to them. Dedupe on `comment_id`.
- **Classify.** The routing model decides whether a comment shows buying
  interest. Complaints and abuse are stored for the seller, never answered.
- **Private reply.** The Send API with `recipient: { comment_id }`, one
  message per comment, within Meta's time window (check the current limit).
  It names the product when the post is linked ("Hi! You asked about the
  Jamdani Saree…") and creates the conversation, linked to the comment, so
  the answer continues in the normal flow.
- **Public reply**, per shop and off by default: a short fixed sentence in
  the shop's language ("Sent you a message 📩"), never with a price, stock, a
  name, a phone number or an address.
- **Settings**, per shop: comment replies on or off, public reply on or off,
  and a per-post opt-out (for a giveaway). These would sit with the
  unbuilt Replies settings on Settings › Messenger
  ([Page connection](../../03-facebook-page/README.md#follow-ups)).
- **Dashboard.** A comment list per post showing whether each was answered,
  linking to the conversation it started.
- **Rate limits.** A queue with per-Page concurrency limits, so a viral post
  does not exhaust Graph's limits. Failures retry with backoff, then surface
  to the seller; the Needs Attention queue that would hold them does not
  exist yet.

## Meta / App Review

The `feed` webhook, `pages_read_user_content` (read comments) and
`pages_manage_engagement` (public reply), both in the Week 4 submission. The
private reply uses `pages_messaging`. Check the names and the private reply
window against Meta's docs.

## Rules it must keep

Public replies never carry prices or customer data. Webhooks are verified and
deduplicated. A comment never confirms an order.

## Tests

- The same comment webhook twice sends one private reply.
- The Page's own comment is ignored.
- A public reply template containing a digit or price fails a check.
- Shop setting off, or the post opted out: nothing sent.
- Two-merchant isolation for comments.

## Done when

- [ ] A comment on a dev Page post produces one private reply and, if
      enabled, one public reply, and the reply leads to a confirmed order.
