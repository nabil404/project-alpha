# 05 · Customers

The people who message the seller's Page: a list with order figures and a
status, and a page per customer with contact details, orders, the latest
conversation and team notes. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model).

**Status (Oct 2026):** built in the API and at `/customers` and
`/customers/:id`. Not built: export and the items under
[Follow-ups](#follow-ups). The order tables belong to
[Orders](../07-orders/README.md).

## Routes (`/api/v1/customers`, session + TenantGuard)

On every `:id` route, a non-UUID id is `400 VALIDATION_FAILED`, and an unknown
id or another shop's is `404 CUSTOMER_NOT_FOUND` with `params.id`.

| Route             | Request                                                                                                                                                                                                                        | Response                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `GET /`           | `filter` (`all` default, `needs_you`, `inactive`, `repeat`, `new`), `q` ≤ 100, `sort` (`last_order` default, `orders`, `total_spent`), `direction` (`desc` default, `asc`), `page` ≥ 1, `pageSize` 10 (default), 25, 50 or 100 | `{ data: CustomerListItem[], pagination: { page, pageSize, total, totalPages } }` |
| `GET /summary`    | none                                                                                                                                                                                                                           | `CustomerSummary`                                                                 |
| `GET /:id`        | none                                                                                                                                                                                                                           | `CustomerDetail`                                                                  |
| `PATCH /:id`      | `{ phone?, deliveryAddress?, area? }`, strict. Omit a field to keep it; `null` or a blank string clears it                                                                                                                     | 200 `CustomerDetail`                                                              |
| `GET /:id/orders` | `page` ≥ 1, `pageSize` 1–50 (default 10)                                                                                                                                                                                       | `{ data: CustomerOrder[], pagination }`, newest first, cancelled included         |
| `GET /:id/notes`  | none                                                                                                                                                                                                                           | `CustomerNote[]`, newest first, not paginated                                     |
| `POST /:id/notes` | `{ body }`, trimmed, 1–2000, strict                                                                                                                                                                                            | 201 `CustomerNote`, authored by the signed-in seller                              |

The shapes are the Zod schemas in
[`packages/shared/src/schemas/customer.ts`](../../../packages/shared/src/schemas/customer.ts).
Money is integer minor units and timestamps are ISO strings.

- `CustomerListItem`: `{ id, name | null, pictureUrl | null, phone | null, area | null, status, orderCount, totalSpent, lastOrderAt | null, lastActiveAt }`.
- `CustomerDetail` adds `deliveryAddress | null`, `averageOrderValue | null`
  (rounded), `createdAt` (first contact) and `latestConversation | null`,
  which is `{ id, state, botPaused, lastMessage: { preview, sender, at } }` for
  the customer's most recently active thread across Pages.
- `CustomerSummary`: `counts { all, needsYou, inactive, repeat, new }`,
  `newInWindow` (first contact in the last 30 days), `repeatCustomers` (2 or
  more orders, whatever the badge), `customersWithOrders`, and
  `averageOrderValue { allTime, currentWindow, previousWindow }`, each null
  with nothing to average. It ignores `q`.
- `CustomerOrder`: `{ id, reference, number, year, status, total, placedAt, items: [{ productName, variantName | null, quantity }] }`.
  See [Orders](../07-orders/README.md) for `reference`, `number` and `year`.
- `CustomerNote`: `{ id, body, author: { id, name } | null, createdAt }`. The
  author is null once their account is deleted.

## Rules

- **Status.** Each customer gets the first that applies. One SQL `CASE` in
  `CustomersRepository.statsQuery` drives the badge, the tab filter and the
  tab counts.
  1. `needs_you`: one of their conversations is `handed_off`.
  2. `inactive`: last activity is older than 60 days (`INACTIVE_AFTER_DAYS`).
  3. `repeat`: 2 or more orders (`REPEAT_MIN_ORDERS`).
  4. `new`: everyone else, including customers with no orders.
- **Last activity** is the latest of first contact, any conversation's
  `last_message_at`, and the last order.
- **Cancelled and returned orders never count** towards `orderCount`,
  `totalSpent`, `lastOrderAt`, the status or the average order value. The
  customer's order list still shows them.
- **Windows roll.** "This month" is the last 30 days
  (`CUSTOMER_STATS_WINDOW_DAYS`) and "last month" the 30 before, so the
  figures need no shop time zone.
- **Search** is a case-insensitive substring match on name, area or phone,
  with `%`, `_` and `\` matched literally. Phones are stored as typed, so a
  term with 3 or more digits also matches the phone's digits alone:
  `1712-345 678` finds `+880 1712 345678`.
- **Sorting.** Customers with no orders sort last in either direction, and
  `id` breaks ties in the sort's direction.
- **Contact details** are the seller's own record. Each order snapshots its
  name, phone and address, so editing a customer never rewrites an order.
  `phone` uses `phoneSchema` (`INVALID_PHONE`). The name comes from Facebook
  and is not editable.
- **No route creates a customer.** A customer row exists because the person
  messaged the Page, keyed by PSID.

## Data model

[`customers.ts`](../../../apps/api/src/modules/database/schema/customers.ts)
and [`orders.ts`](../../../apps/api/src/modules/database/schema/orders.ts).
Each table has row-level security enabled and forced, with a
`*_merchant_isolation` policy.

- `customer`: `psid`, plus `name` and `picture_url` from Facebook (see
  [Conversations](../04-conversations/README.md#data-model)), and the seller's
  `phone`, `delivery_address` and `area`, all nullable.
  `UNIQUE (merchant_id, psid)`, and a trigram index on `name`.
- `customer_note`: `customer_id` (a `(merchant_id, customer_id)` foreign key
  that cascades), `author_id` → `user.id` `ON DELETE SET NULL`, and `body`.
  Indexed on `(merchant_id, customer_id, created_at DESC, id)`.
- `order` and `order_item`: see [Orders](../07-orders/README.md#data-model).

## Web

- **`/customers`** shows the four figures from `/summary`, the status tabs
  with counts, search, and a page of customers. From `sm` up it is a table
  whose Orders, Total spent and Last order headers sort (a new column starts
  descending, a second click flips it); below `sm` it is a list of cards. The
  URL holds `show`, `q`, `sort`, `direction`, `page` and `pageSize`, each left
  out at its default. The filter is `show` because Conversations already uses
  `filter`.
- **Figures.** The repeat rate is `repeatCustomers / customersWithOrders`. The
  average order value is `allTime`, with a trend from `currentWindow` against
  `previousWindow` when both exist. "Need a reply" is `counts.needsYou` and
  links to Conversations filtered to `needs_you`.
- **`/customers/:id`** shows the badge and "Customer since", Open chat, three
  figures, the paged orders (each linking to `/orders/:id`), the latest
  conversation, the contact card with an Edit dialog (`updateCustomerSchema`),
  and the notes.
- **Badges** (`src/i18n/status-tones.ts`): Repeat is accent, New success,
  Needs you warning, Inactive neutral.
- **Code:** `apps/web/src/features/customers/` and
  `apps/web/src/routes/_app/customers/`. `ChatCustomerDetails` shows the same
  customer beside a conversation. The pagination bar is
  `src/components/PaginationBar.tsx`. Money goes through `useFormatters()` in
  the shop's currency ([Settings – General](../06-settings-general/README.md#dashboard)).

## Code and tests

`apps/api/src/modules/customers/`. `CustomersRepository` builds one aggregate
subquery (orders and conversations grouped per customer, status in SQL) for
the list, summary and detail. `CustomerNotesRepository` holds the notes. Every
query runs in `withMerchant` and filters on `merchant_id`.

- `__tests__/customers.repository.spec.ts`: two merchants, as `app_runtime`.
- `__tests__/customers.e2e.spec.ts`: over HTTP.
- `database/__tests__/orders-schema.spec.ts`: keys, checks and RLS.
  `database/__tests__/order-seeds.ts` seeds orders for tests.

## Follow-ups

- **Contact details from the chat.** Copy phone and address onto the customer
  when an order is confirmed, so the seller does not type them.
- **A sort control on phones.** Below `sm` the list keeps the URL's sort but
  has no headers to change it.
- **Not built:** export, "New order" on the customer page (Orders' Create
  order dialog exists but this page does not open it), "Preferred payment",
  editing or deleting a note, and "Add customer".
- **Scale.** The list aggregates every order and conversation of the shop on
  each request. Past a few thousand customers, store the figures on
  `customer`, or add trigram indexes on `phone` and `area` if search slows
  first.
