# 11.3 · Entry points

**Status:** not started.

## Goal

A conversation can start with context instead of a blank "hi": a Get Started
button and menus to browse the catalog, a Messenger link or QR code per
product, and click-to-Messenger ads that name the product up front.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md): matching, facts and the
summary card. A product chosen from an entry point skips straight to the
variant slot.

## Scope

- **Messenger Profile** (set on Page connect and when the seller changes it):
  - Get Started button with a payload that starts browsing.
  - Ice breakers (up to four questions, e.g. "See products", "Delivery
    charge?"), with defaults the seller can edit.
  - Persistent menu: Browse products, My last order, Talk to a person (hands
    off).
  - Greeting text in the shop's language.
- **Quick-reply browsing.** "Browse" lists categories as quick replies, then up
  to ten products in a category as a carousel (cover image, name, starting
  price, a "Choose" button). The choice fills the product slot.
- **Product links.** Each active product gets a link
  `m.me/<page>?ref=p_<productId>` and a downloadable QR code on its dashboard
  page ("Copy Messenger link"). A referral resolves to the product only if it
  belongs to the Page's merchant and is active; otherwise it is ignored.
- **Click-to-Messenger ads.** The referral's `ad_id` is looked up in an
  `ad_product` table (merchant_id, page_id, ad_id, product_id) with RLS. The
  dashboard lists ad IDs seen in referrals that have no product yet, so the
  seller maps them once. An unmapped ad starts a normal conversation.
- **Webhook.** Accept `referral` on messages and postbacks and the standalone
  `messaging_referrals` event; the job gains a `referral` field stored on the
  conversation (`source: ad | link | get_started | organic`) for later
  reporting.

## Meta / App Review

Subscribe `messaging_referrals` (add to `PAGE_WEBHOOK_FIELDS`; connected Pages
resubscribe). The Messenger Profile API uses the Page token and
`pages_messaging`. No new permission.

## Rules it must keep

A referral's product is a fact only after checking it belongs to that seller and
is active. Menus never quote prices that are not from the catalog.

## Tests

- Referral parsing: link, ad, Get Started; a product from another merchant or an
  archived one is ignored.
- Browsing: categories with no active products are hidden.
- `ad_product` repository: two-merchant isolation.
- Messenger Profile is re-applied idempotently after reconnect.

## Done when

- Scanning a product's QR code on a phone opens Messenger, and the assistant
  asks for the variant of that product.
- Get Started → category → product → confirmed order works on the dev Page.
- A test ad referral maps to a product after the seller assigns it.
