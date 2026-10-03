# Domain

## Conversation states

`browsing → collecting_details → awaiting_confirmation → confirmed`, plus
`handed_off` and `abandoned`.

Required order fields: product, variant, quantity, customer name, phone,
delivery address.

## Order statuses

`New → Confirmed → Packed → Shipped → Delivered`, or `Cancelled`.

## Data model

- **Seller / User** — account and auth identities (password, Google, Facebook).
  The `user`, `session`, `account`, and `verification` tables are owned by
  Better Auth. Their Drizzle schema is generated with the Better Auth CLI into
  `apps/api/src/modules/database/schema/auth.ts` and migrated through drizzle-kit like
  any other table, so auth changes stay versioned and reviewed.
- **Organization** (seller account / tenant) — via the Better Auth Organization
  plugin, created automatically at signup with the seller as its owner. The
  model permits several organizations per seller, because membership is a table
  rather than a column; the MVP ships one and offers no switcher, so adding one
  later needs no migration. Every business table carries `merchant_id`, which
  references `organization(id)` and never `user(id)`, and all queries are scoped
  by it.
- **Merchant settings** — one row per shop, written at email sign-up or on its first save: country,
  currency, time zone, date format, contact phone (E.164) and pickup address.
  The shop's name and logo stay on the organization. An email sign-up starts
  the shop in the region of the seller's phone number; a shop with no row
  reads as the default region (Bangladesh). The currency is what every price and
  order is in: it can change only until the shop's first order, and a change
  keeps each price's number (rescaling minor units when the decimals differ),
  never converting it. The dashboard language belongs to each person
  (`user.locale`), not the shop; unset, it follows the shop's country.
- **Page** — connected Facebook Page, encrypted token, bot on/off.
- **Product / Option / Variant** — product: name, aliases (shown to sellers
  as Tags), description, images, a cover image, delivery charge, status
  (`draft`, `active`, `archived`; shown as Draft, Published, Archived). A
  product varies on up to 3 options (Size, Sleeve), each with ordered values;
  each variant is one combination of values, one per option, with its own
  SKU (unique per seller among live variants), price, stock count and
  optional image. A product always has at least one live variant; one with
  no options has a single unnamed default variant. A variant's name is the
  one the seller gives it, or else its values joined ("M / Short"); it is
  unique within the product and kept on archived variants for their orders.
  Variants are archived, never deleted individually, so orders keep pointing
  at them; removing a value archives its variants. A product hard delete
  cascades to its variants and is refused once orders reference one. The
  cover is the photo the assistant sends when no variant is picked, and for
  variants without their own; gallery order does not change it. The dashboard
  saves a product's options and variants as one document; a single
  variant's SKU, price, stock or image can also change on its own. Every write
  to them bumps the product's revision, so a save from an outdated page is
  refused. Order confirmation and cancellation, which change stock, must bump
  it too. The AI sees only active products and their live variants. Stock is
  decremented when an order is confirmed and restored if it is cancelled.
- **Category** — a seller's flat list, no nesting; names unique per seller.
  A product can sit in several categories. Deleting one is a soft delete and
  removes it from its products.
- **Customer** — Messenger PSID, name, picture, and the contact details the
  seller keeps on file: phone, delivery address, area. Each order snapshots
  its own copy, so editing these never rewrites an order. The picture is
  Facebook's profile link, which expires after a few days: it is re-read every
  three days, when the customer writes and by a daily worker job for anyone
  active in the last 30 days, and the dashboard falls back to initials. The
  Customers page shows one status per customer, the first that applies: needs
  you (a conversation is handed off), inactive (no message or order for 60
  days), repeat (two or more orders), new. Cancelled orders never count.
- **Customer note** — free text the seller's team keeps on a customer, with
  its author; the customer never sees it.
- **Conversation** — customer, Page, state, collected slots, bot paused flag.
  `bot_paused` is the seller taking over (by hand, by replying from the
  dashboard, or by replying from Facebook's own inbox); `handed_off` is the
  assistant giving up. They are independent: handing back clears the first and
  resumes the second.
- **Message** — sender (`customer`, `assistant`, `seller`), content, status
  (`sending`, `sent`, `failed`), timestamps, Meta message ID (none while a
  reply is `sending`).
- **Order / OrderItem** — items, totals, currency (the shop's at the time),
  delivery charge, status, notes, linked conversation. The tables exist so the Customers pages can read order
  history; their shape is provisional until the orders work creates orders.

Money is stored as integer minor units of the shop's currency (e.g.
paisa/cents; the currency's ISO 4217 exponent decides how many), never floats
or `numeric`.
