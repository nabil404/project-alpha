# 11.3 · Entry points

**Status:** not started ([progress](../progress.md)). As of Oct 13, 2026 the
webhook ignores `referral`, and `PAGE_WEBHOOK_FIELDS` is `messages`,
`messaging_postbacks` and `message_echoes`.

## Goal

A conversation starts with context instead of a blank "hi": a Get Started
button and menus to browse the catalog, a Messenger link or QR code per
product, and click-to-Messenger ads that name the product.

## Depends on

[Phase 2](../phase-2-catalog-confirm-orders/README.md): matching, facts and the
summary card. A product chosen from an entry point goes straight to the
variant question.

## Scope

- **Messenger Profile**, set on Page connect and when the seller edits it:
  - a Get Started button whose payload starts browsing;
  - up to four ice breakers ("See products", "Delivery charge?"), with
    defaults the seller can edit;
  - a persistent menu: Browse products, My last order, Talk to a person
    (hands off);
  - greeting text in the shop's language.
- **Quick-reply browsing.** Browse lists categories as quick replies, then up
  to ten of a category's products as a carousel (cover image, name, starting
  price, a Choose button). The choice fills the product slot.
- **Product links.** Each active product gets
  `m.me/<page>?ref=p_<productId>` and a downloadable QR code on its dashboard
  page ("Copy Messenger link"). A referral counts only if its product is
  active and belongs to the Page's merchant.
- **Click-to-Messenger ads.** The referral's `ad_id` is looked up in a new
  `ad_product` table (`merchant_id`, `page_id`, `ad_id`, `product_id`) with
  RLS. The dashboard lists ad ids seen in referrals without a product, so the
  seller maps each once. An unmapped ad starts a normal conversation.
- **Webhook.** Accept `referral` on messages and postbacks and the standalone
  `messaging_referrals` event. The job gains a `referral` field, stored on the
  conversation as `source` (`ad`, `link`, `get_started`, `organic`) for
  reporting.

## Meta / App Review

Add `messaging_referrals` to `PAGE_WEBHOOK_FIELDS`; connected Pages must
resubscribe. The Messenger Profile API uses the Page token and
`pages_messaging`. No new permission.

## Rules it must keep

A referral's product becomes a fact only after checking it is active and
belongs to that seller. Menus never quote a price that is not from the
catalog.

## Tests

- Referral parsing for a link, an ad and Get Started; another merchant's or
  an archived product is ignored.
- Browsing hides categories with no active products.
- `ad_product` repository: two-merchant isolation.
- Messenger Profile is re-applied idempotently after a reconnect.

## Done when

- [ ] Scanning a product's QR code on a phone opens Messenger, and the
      assistant asks for that product's variant.
- [ ] Get Started → category → product → confirmed order works on the dev
      Page.
- [ ] A test ad referral maps to a product after the seller assigns it.
