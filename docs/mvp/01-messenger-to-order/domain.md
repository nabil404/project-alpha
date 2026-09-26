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
  `apps/api/src/database/schema/auth.ts` and migrated through drizzle-kit like
  any other table, so auth changes stay versioned and reviewed.
- **Organization** (seller account / tenant) — via the Better Auth Organization
  plugin, created automatically at signup with the seller as its owner. The
  model permits several organizations per seller, because membership is a table
  rather than a column; the MVP ships one and offers no switcher, so adding one
  later needs no migration. Every business table carries `merchant_id`, which
  references `organization(id)` and never `user(id)`, and all queries are scoped
  by it.
- **Page** — connected Facebook Page, encrypted token, bot on/off.
- **Product / Variant** — name, aliases, price, images, stock status, delivery
  charge.
- **Customer** — Messenger PSID, name, phone, address.
- **Conversation** — customer, Page, state, collected slots, bot paused flag.
- **Message** — direction, content, timestamps, Meta message ID.
- **Order / OrderItem** — items, totals, delivery charge, status, notes, linked
  conversation.

Money is stored as integer minor units (e.g. paisa/cents), never floats or
`numeric`.
