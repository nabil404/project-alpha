# 05 · Customers

The seller's view of the people who message their Page: a list with order
figures and a status, and a page per customer with contact details, orders,
the latest conversation and team notes. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model); the
screens are the Customers and Customer detail artboards in the design canvas.
This page describes what is built.

**Status (Oct 2026):** built end to end: list, summary, detail, contact edits,
a customer's orders, and notes, in the API and at `/customers` and
`/customers/:id` in the dashboard. The order tables these pages read belong
to [Orders](../07-orders/README.md). Not built yet: export and the items
under [Follow-ups](#follow-ups).

## Routes (`/api/v1/customers`, session + TenantGuard)

A non-UUID `:id` is `400 VALIDATION_FAILED`; an unknown id, or another shop's,
is `404 CUSTOMER_NOT_FOUND` with `params.id` (never 403), on every `:id` route.

| Route             | Request                                                                                                                                                                                                                        | Response                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /`           | `filter` (`all` default, `needs_you`, `inactive`, `repeat`, `new`), `q` ≤ 100, `sort` (`last_order` default, `orders`, `total_spent`), `direction` (`desc` default, `asc`), `page` ≥ 1, `pageSize` 10 (default), 25, 50 or 100 | `{ data: CustomerListItem[], pagination: { page, pageSize, total, totalPages } }` |
| `GET /summary`    | —                                                                                                                                                                                                                              | `CustomerSummary`, ignoring `q`                                                   |
| `GET /:id`        | —                                                                                                                                                                                                                              | `CustomerDetail`                                                                  |
| `PATCH /:id`      | `{ phone?, deliveryAddress?, area? }`, strict. Omit to keep; `null` or a blank string clears                                                                                                                                   | 200 `CustomerDetail`                                                              |
| `GET /:id/orders` | `page` ≥ 1, `pageSize` 1–50 (default 10)                                                                                                                                                                                       | `{ data: CustomerOrder[], pagination }`, newest first, cancelled included         |
| `GET /:id/notes`  | —                                                                                                                                                                                                                              | `CustomerNote[]`, newest first, not paginated                                     |
| `POST /:id/notes` | `{ body }`, trimmed, 1–2000, strict                                                                                                                                                                                            | 201 `CustomerNote`, authored by the signed-in seller                              |

Shapes are the Zod schemas in
[`packages/shared/src/schemas/customer.ts`](../../../packages/shared/src/schemas/customer.ts).
Money is integer minor units; timestamps are ISO strings.

- `CustomerListItem`: `{ id, name | null, pictureUrl | null, phone | null, area | null, status, orderCount, totalSpent, lastOrderAt | null, lastActiveAt }`.
- `CustomerDetail`: the list item plus `deliveryAddress | null`,
  `averageOrderValue | null` (rounded; null with no orders), `createdAt` (first
  contact) and `latestConversation | null`:
  `{ id, state, botPaused, lastMessage: { preview, sender, at } }`, the
  customer's most recently active thread across Pages. "Open chat" links to
  `/conversations/:id`.
- `CustomerSummary`: `counts { all, needsYou, inactive, repeat, new }` for the
  tabs; `newInWindow` (first contact in the last 30 days, "+96 this month");
  `repeatCustomers` (2+ orders, whatever their badge) and
  `customersWithOrders`, so the page picks the repeat-rate denominator;
  `averageOrderValue { allTime, currentWindow, previousWindow }`, each null
  when there was nothing to average. "Need a reply" is `counts.needsYou`.
- `CustomerOrder`: `{ id, number, status, total, placedAt, items: [{ productName, variantName | null, quantity }] }`.
  `number` is the shop's sequence as an integer; the web formats it
  (`ORD-2026-00481`).
- `CustomerNote`: `{ id, body, author: { id, name } | null, createdAt }`.

## Rules

- **Status,** one per customer, the first that applies; the same SQL `CASE`
  drives the badge, the tab filter and the tab counts:
  1. `needs_you`: any of their conversations is `handed_off`.
  2. `inactive`: last activity older than 60 days (`INACTIVE_AFTER_DAYS`).
  3. `repeat`: 2 or more orders (`REPEAT_MIN_ORDERS`).
  4. `new`: everyone else, including customers with no orders.
- **Last activity** is the latest of first contact, any conversation's
  `last_message_at`, and the last order.
- **Cancelled and returned orders never count**: not in `orderCount`, `totalSpent`,
  `lastOrderAt`, the status, or average order value. The customer's order list
  still shows them.
- **Windows are rolling,** not calendar months: "this month" is the last 30
  days (`CUSTOMER_STATS_WINDOW_DAYS`) and "vs last month" the 30 before, so no
  shop time zone is needed.
- **Search** is a case-insensitive substring on name, area or phone; `%`, `_`
  and `\` are matched literally. A term with 3 or more digits also matches the
  phone with its separators stripped, so `01712345678` finds `01712-345678`.
- **Sorting.** Customers with no orders sort last in either direction; `id`
  breaks ties in the sort's direction.
- **Pagination** is by page number, not a cursor: the design shows "1–10 of
  1,284" and numbered pages, and the list is sorted on figures that do not
  move with each message.
- **Contact details** are the seller's own record. An order snapshots name,
  phone and address when it is placed, so editing the customer never rewrites
  an order. `phone` uses the shared `phoneSchema` (`INVALID_PHONE`). The name
  is Facebook's and is not editable.
- **Customers are never created here.** A customer exists because they
  messaged the Page (keyed by PSID), so the design's "Add customer" has no
  route.

## Data model

Schema in
[`customers.ts`](../../../apps/api/src/modules/database/schema/customers.ts)
and [`orders.ts`](../../../apps/api/src/modules/database/schema/orders.ts).
Every table has RLS enabled and forced with a `*_merchant_isolation` policy,
and composite `(merchant_id, id)` foreign keys.

- `customer`: `psid`, `name` and `picture_url` (from Facebook, see
  [Conversations](../04-conversations/README.md#data-model)), and the
  seller's `phone`, `delivery_address` and `area`, all nullable.
  `UNIQUE (merchant_id, psid)`.
- `customer_note`: `customer_id` (cascades with the customer), `author_id` →
  `user.id` `ON DELETE SET NULL`, `body`. Indexed on
  `(merchant_id, customer_id, created_at DESC, id)`.
- `order` and `order_item`: see [Orders](../07-orders/README.md#data-model).
  These pages read them through `(merchant_id, customer_id, placed_at DESC, id)`.

## Web

- **`/customers`**: the four figures from `/summary`, the status tabs with
  their counts, search, and a page of customers: a table from `sm` up, with
  Orders, Total spent and Last order sortable (a new column starts largest or
  latest first; clicking it again flips it), and cards below it. The query
  lives in the URL as `show`, `q`, `sort`, `direction`, `page` and `pageSize`,
  each left out at its default. The filter is `show`, not `filter`, because
  Conversations already uses `filter`.
- **Figures.** The repeat rate is `repeatCustomers / customersWithOrders`: of
  the customers who ordered, how many came back. The average order value is
  `allTime`, and its trend compares `currentWindow` with `previousWindow`,
  shown only when both exist. "Need a reply" links to Conversations filtered
  to `needs_you`.
- **`/customers/:id`**: the badge and "Customer since", Open chat (the latest
  conversation), the three figures, the orders (paged, `ORD-<year placed>-<number
padded to 5>`, each linking to its order), the latest conversation,
  the contact card with an Edit dialog (the shared `updateCustomerSchema`; a
  blank field clears), and the notes with a box to add one.
- **Badges.** Repeat is accent, New success, Needs you warning, Inactive
  neutral (`status-tones.ts`, `docs/DESIGN.md`); order statuses use the tones
  DESIGN.md already lists.
- Code: `apps/web/src/features/customers/`, routes under
  `apps/web/src/routes/_app/customers/`. The pagination bar is shared from
  `src/components/PaginationBar.tsx`, and the shop's currency is `SHOP_CURRENCY`
  in `src/lib/currency.ts`.

## Code

`apps/api/src/modules/customers/`: `CustomersRepository` holds the aggregate
query (orders and conversations grouped per customer, joined to `customer`,
status computed in SQL) behind the list, summary and detail;
`CustomerNotesRepository` the notes. Every query runs in `withMerchant` and
filters on `merchant_id`. Tests: `__tests__/customers.repository.spec.ts`
(two merchants, as `app_runtime`), `__tests__/customers.e2e.spec.ts` (over
HTTP) and `database/__tests__/orders-schema.spec.ts` (keys, checks, RLS).
`database/__tests__/order-seeds.ts` seeds orders for tests.

## Follow-ups

- **Orders work:** create orders from a confirmed conversation (per-shop
  `number` sequence, idempotency), and decide the `order_item` product and
  variant keys. Revisit these tables then; this page's routes read only
  `customer_id`, `status`, `total`, `placed_at`, `number` and the item
  snapshots.
- **Contact details from the chat:** copy phone and address into the customer
  when an order is confirmed, so the list fills without the seller typing.
- **Web:** a sort control on phones (below `sm` the list keeps the URL's sort
  but shows no headers to change it), and links from an order row once orders
  have a page.
- **Not built:** export (the design's Export button), "New order" (orders
  work), "Preferred payment" (no payment method in the domain yet), deleting
  or editing a note, and "Add customer" (see Rules).
- **Scale:** the list aggregates every order and conversation of the shop on
  each request. That is fine at MVP size; past a few thousand customers,
  denormalize the figures onto `customer`, or add trigram indexes on `phone`
  and `area` if search slows first.
