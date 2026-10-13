# 11.5 · Shared posts and ads

**Status:** not started ([progress](../progress.md)).

## Goal

A customer who shares one of the Page's posts or ads into Messenger ("how much
is this?") gets an answer about the right product. Sellers link their posts to
products once.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md) (matching) and
[phase 3](../phase-3-entry-points/README.md) (referrals and `ad_product`).

## Scope

Code resolves the product before the LLM runs, most exact first. A resolved
product becomes a fact; prices come from the catalog, never a caption.

1. **Referral** (`m.me/<page>?ref=…` or an ad): handled by phase 3.
2. **A post the seller linked**, in a new `product_post` table
   (`merchant_id`, `product_id`, `post_id`) with RLS. The product page lets the
   seller paste post URLs or pick from the Page's recent posts.
3. **The post's caption**, read with `GET /{post-id}?fields=message,permalink_url`
   and the Page token, goes to extraction for matching. Because the product is
   inferred, the assistant confirms it ("Do you mean the Jamdani Saree?") and
   stores the post-to-product link as a suggestion the seller can accept.
4. **Unresolved:** ask which product, then hand off.

- **Webhook.** Accept `share` and `fallback` attachments, so a shared post
  with no text starts a turn. The job gains `links[]`.
- **Security.** Only facebook.com, fb.me and m.me hosts are parsed. A short
  `share/p/` link gets one redirect hop with a timeout. No other URL is
  fetched (SSRF).
- **Capture first.** Share payloads are poorly documented, so record real ones
  on the dev Page before writing the parser.

## Meta / App Review

`pages_read_engagement`, to read posts and list the Page's recent ones. Add it
to `PAGE_CONNECT_SCOPES` in `meta-graph.client.ts`; connected Pages reconnect
to grant it.

**Review-date conflict.** Its screencast needs the post picker and caption
matching on the dev Page by the Week 4 submission (around Oct 18), before
this phase comes up. Build the picker early for the recording, or request the
permission in a second round. If Meta refuses it, steps 1, 2 (pasted URLs
only) and 4 still ship.

## Rules it must keep

Prices only from the catalog. The customer confirms an inferred product
before it fills the slot.

## Tests

- URL parsing accepts the allowed hosts only, rejects `javascript:`, IPs and
  other hosts, and follows at most one redirect.
- A linked post resolves without an LLM call; an unlinked one goes through
  the caption and asks to confirm.
- `product_post` repository: two-merchant isolation.

## Done when

- [ ] Sharing a linked post into the dev Page's chat starts the variant
      question for that product.
- [ ] Sharing an unlinked post produces a "Do you mean …?" question and a
      suggestion the seller can accept.
