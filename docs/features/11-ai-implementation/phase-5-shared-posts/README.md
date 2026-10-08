# 11.5 · Shared posts and ads

**Status:** not started.

## Goal

A customer who shares one of the Page's posts or ads into Messenger ("how much
is this?") gets an answer about the right product. Sellers link their posts to
products once.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching) and
[phase 3](../phase-3-entry-points/README.md) (referrals and the `ad_product`
table).

## Scope

Resolved by code before the LLM runs, most exact first. A resolved product
becomes a fact; prices always come from the catalog, never from a post caption.

1. **Referral** (`m.me/<page>?ref=…`, ad referral): already handled in phase 3.
2. **Post links the seller attached:** a `product_post` table (merchant_id,
   product_id, post_id) with RLS. The product page lets the seller paste post
   URLs or pick from the Page's recent posts.
3. **Read the post:** `GET /{post-id}?fields=message,permalink_url` with the Page
   token. The caption goes to extraction for catalog matching. Because the
   product is inferred, the assistant confirms it ("Do you mean the Jamdani
   Saree?") and stores the post→product suggestion for the seller to accept.
4. **Unresolved:** ask which product, then hand off.

- **Webhook.** Accept `share` and `fallback` attachments; a shared post with no
  text now starts a turn. The job gains `links[]`.
- **Security.** Only facebook.com, fb.me and m.me hosts are parsed or resolved.
  Short `share/p/` links get one redirect hop with a timeout. No other URL is
  ever fetched (SSRF).
- **Capture first.** Record real share payloads on the dev Page before writing
  the parser; the shapes are not well documented.

## Meta / App Review

`pages_read_engagement` for reading posts and listing the Page's recent posts.
Add it to the Page permissions in `meta-graph.client.ts`; connected Pages must
reconnect to grant it.

**Conflict with the review date:** its screencast needs the post picker and
caption matching working on the dev Page by the Week 4 submission (around
Oct 18), before this phase's turn in the order. Either build the picker early
for the recording or request the permission in a second review round. If Meta
rejects it, steps 1, 2 (pasted URLs only) and 4 still ship.

## Rules it must keep

Prices only from the catalog, never from a caption. An inferred product is
confirmed by the customer before it fills the slot.

## Tests

- URL parsing: allowed hosts only; `javascript:`, IP and other hosts rejected;
  one redirect hop at most.
- A linked post resolves without an LLM call; an unlinked one goes through the
  caption and asks for confirmation.
- `product_post` repository: two-merchant isolation.

## Done when

- Sharing a linked post into the dev Page's chat starts the variant question for
  that product.
- Sharing an unlinked post produces a "Do you mean …?" question and a suggestion
  the seller can accept.
