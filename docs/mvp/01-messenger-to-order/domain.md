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
- **Page** — connected Facebook Page, encrypted token, bot on/off.
- **Product / Option / Variant** — product: name, aliases (shown to sellers
  as Tags), description, images, a cover image, delivery charge, status
  (`draft`, `active`, `archived`; shown as Draft, Published, Archived). A
  product varies on up to 3 options (Size, Sleeve), each with ordered values;
  each variant is one combination of values, one per option, with its own
  SKU (unique per seller among live variants), price, stock count and
  optional image. A product always has at least one live variant; one with
  no options has a single unnamed default variant. A variant's name is its
  values joined ("M / Short"), kept on archived variants for their orders.
  Variants are archived, never deleted individually, so orders keep pointing
  at them; removing a value archives its variants. A product hard delete
  cascades to its variants and is refused once orders reference one. The
  cover is the photo the assistant sends when no variant is picked, and for
  variants without their own; gallery order does not change it. The dashboard
  saves a product's options and variants as one document, and every write to
  them bumps the product's revision, so a save from an outdated page is
  refused. Order confirmation and cancellation, which change stock, must bump
  it too. The AI sees only active products and their live variants. Stock is
  decremented when an order is confirmed and restored if it is cancelled.
- **Category** — a seller's tree, at most 3 levels deep; names unique per seller.
  A product can sit in several categories. Deleting one is a soft delete, refused
  while it has subcategories, and removes it from its products.
- **Customer** — Messenger PSID, name, picture, phone, address (phone and
  address are stored from the orders work on). The picture is Facebook's
  profile link, which expires after a few days: it is re-read every three days,
  when the customer writes and by a daily worker job for anyone active in the
  last 30 days, and the dashboard falls back to initials.
- **Conversation** — customer, Page, state, collected slots, bot paused flag.
  `bot_paused` is the seller taking over (by hand, by replying from the
  dashboard, or by replying from Facebook's own inbox); `handed_off` is the
  assistant giving up. They are independent: handing back clears the first and
  resumes the second.
- **Message** — sender (`customer`, `assistant`, `seller`), content, status
  (`sending`, `sent`, `failed`), timestamps, Meta message ID (none while a
  reply is `sending`).
- **Order / OrderItem** — items, totals, delivery charge, status, notes, linked
  conversation.

Money is stored as integer minor units (e.g. paisa/cents), never floats or
`numeric`.
