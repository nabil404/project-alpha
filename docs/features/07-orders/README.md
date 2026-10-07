# 07 · Orders

The seller's order desk: a list with stat cards and status tabs, and a page
per order where the seller confirms, packs, ships and delivers it, edits its
items and delivery details, records payment and tracking, and reads its
activity. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model); the screens
are the Orders and Order detail artboards in the design canvas. This page
describes what is built.

**Status (Oct 2026):** built end to end, in the API and at `/orders` and
`/orders/:id` in the dashboard. Not built yet: CSV export, the order summary
sent to the customer in Messenger on confirmation, the email to the seller
about a new order, and the assistant's own order creation (the conversation
flow will write `source = assistant` orders). See [Follow-ups](#follow-ups).

## Routes (`/api/v1/orders`, session + TenantGuard)

A non-UUID `:id` is `400 VALIDATION_FAILED`; an unknown id, or another shop's,
is `404 ORDER_NOT_FOUND` (never 403), on every `:id` route. Every change takes
the `version` the page read; a change from an older read is
`409 ORDER_STALE`, as the product edit page's is.

| Route                  | Request                                                                                                                                                                                                      | Response                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `GET /`                | `status` (`all` default, or an order status), `q` ≤ 100, `from`, `to` (instants), `sort` (`placed_at` default, `total`), `direction` (`desc` default), `page`, `pageSize` 10/25/50/100                       | `{ data: OrderListItem[], pagination }`      |
| `GET /summary`         | `q`, `from`, `to`                                                                                                                                                                                            | `OrderSummary`                               |
| `POST /`               | `CreateOrder`, optional `Idempotency-Key` header                                                                                                                                                             | 201 `OrderDetail`                            |
| `GET /:id`             | —                                                                                                                                                                                                            | `OrderDetail`                                |
| `GET /:id/activity`    | —                                                                                                                                                                                                            | `OrderEvent[]`, newest first, not paginated  |
| `POST /:id/status`     | `{ status, note?, version }`; `note` is the reason kept on the activity (why it was cancelled), not the order's internal note                                                                                | 200 `OrderDetail`                            |
| `PUT /:id/items`       | `{ items: [{ variantId, quantity, unitPrice? }], version }`                                                                                                                                                  | 200 `OrderDetail`                            |
| `PATCH /:id`           | `{ customerName?, phone?, deliveryAddress?, deliveryArea?, deliveryChargeId?, deliveryFee?, paymentStatus?, paymentMethod?, trackingNumber?, note?, version }`; `note` is the internal note (column `notes`) | 200 `OrderDetail`                            |
| `POST /delivery-quote` | `{ deliveryChargeId, items: [{ variantId, quantity, unitPrice? }] }`; writes nothing                                                                                                                         | 200 `{ fee, subtotal, freeDeliveryApplied }` |

Shapes are the Zod schemas in
[`packages/shared/src/schemas/order.ts`](../../../packages/shared/src/schemas/order.ts).
Money is integer minor units of the order's `currency`; timestamps are ISO
strings. `reference` (`ORD-2026-00481`) is assigned by the API when the order
is placed and shown as is: `year` is the calendar year it was placed in the
shop's time zone, `number` counts the shop's orders from 1 within that year,
zero-padded to five digits and widening past them (`ORD-2026-100000`).

- `OrderListItem`: reference, number, year, source, status, payment, the customer's id with the
  name and phone the order was placed with, the first line and `itemCount`
  ("Blue kurti, M × 2 +1 more"), total, currency, `placedAt`.
- `OrderSummary`: `counts` per tab under the same `q`, `from` and `to` as the
  list, so the tabs agree with the table; and cards that ignore them:
  `awaitingConfirmation` (the "Drafted" orders, whenever placed), `toShip`
  (`confirmed`, `packed`), `revenue` over the last 30 days and the 30 before,
  and `placedInWindow` (`all`, `byAssistant`) for "Drafted by the assistant
  71%".
- `OrderDetail`: the order with `version`, `nextStatuses` (the buttons to
  show), lines with SKU and `lineTotal`, `deliveryFee`, `delivery { name,
phone, address, area, chargeId, everywhereElse, time }`, `trackingNumber`, `note`, `customer { id, name, pictureUrl,
earlierOrderCount, spentBefore }` ("Repeat customer · 2 earlier orders"),
  and `conversationId` for "Open chat" (null for an order the seller added).
- `OrderEvent`: `{ id, data, actor: { id, name } | null, createdAt }`, where
  `data` is one of `created`, `status_changed` (with the seller's note),
  `items_changed` (totals before and after), `delivery_changed` (which of
  `name`, `phone`, `address`, `area`, `fee`; events stored before the rename
  said `zone` and `charge` and read as these), `payment_changed` (status
  and/or method, from and to) and `tracking_changed`. Editing the internal note
  records no event. `actor` is null for the assistant.

## Rules

- **Lifecycle:** `new → confirmed → packed → shipped → delivered → returned`,
  and `cancelled` from anything before `delivered`. The design's "Drafted" is
  `new`: the customer has confirmed in Messenger, and the seller confirms
  again on the dashboard. Moves are `canTransitionOrder` in `@app/shared`;
  anything else is `409 ORDER_INVALID_TRANSITION` with `from` and `to`.
- **Stock** is held while the order is `confirmed`, `packed`, `shipped` or
  `delivered` (`orderHoldsStock`). A move or an item edit takes or gives back
  the difference between what the order held before and after, netted per
  variant. Taking more than a variant has is
  `409 ORDER_INSUFFICIENT_STOCK` with `variantId`, `name` and `available`,
  and nothing changes. Every stock move bumps the product's revision, so a
  product edit page open on it sees it changed. Products are locked in id
  order before their variants, as the product save does, so the two never
  deadlock.
- **Items** change only while the order is `new` or `confirmed`
  (`409 ORDER_NOT_EDITABLE` after). A variant already on the order keeps its
  name, SKU and price, even if since archived; a new one must be live and is
  priced from the catalog. `unitPrice` overrides either. A variant may appear
  once (`DUPLICATE`); 1–50 lines.
- **Delivery details** (name, phone, address, area, fee) change until the
  order ships; payment, tracking number and the note at any time. They are the
  order's own snapshot: the customer's record never changes. A field sent back
  unchanged is no change, and a PATCH that changes nothing keeps the version.
- **Delivery area.** `deliveryChargeId` links one of the shop's
  [delivery charges](../09-settings-delivery/README.md) (an area, or
  everywhere else) and copies onto the order its area name (unless
  `deliveryArea` is sent), whether it is everywhere else, and its delivery
  time, shown as "Estimated 1–2 days after shipping". `null` unlinks and
  clears all three. Removing the area in Settings keeps the copies and clears
  only the link. Another shop's id → `404 DELIVERY_CHARGE_NOT_FOUND`. A
  typed `deliveryArea` with no link still works, for orders from before.
- **Delivery fee** is stored as sent and never recomputed: required on
  `POST /`, changeable until the order ships, and kept when items change.
  `total = subtotal + delivery_fee`, enforced by a check. The dashboard fills
  it in from `POST /delivery-quote`: each product's own charge for the area,
  or the shop's where it sets none; the highest of those, not the sum; and
  nothing once the subtotal reaches the shop's free-delivery threshold
  (`deliveryFeeFor` in `@app/shared`, the rule the assistant will quote
  with). The quote prices items as sent, else at the catalog price, archived
  variants included.
- **Payment** is the seller's record only (`unpaid`, `paid`, `refunded`;
  `cash_on_delivery`, `bank_transfer`, `mobile_wallet`); the MVP takes no
  payments.
- **Revenue and customer figures** leave out `cancelled` and `returned`
  orders. The windows are rolling 30 days, as on Customers.
- **Dates:** `from` is inclusive and `to` exclusive. The page turns "Today" or
  "This month" into instants in the shop's time zone, so the API never
  guesses one; `from` must be before `to`.
- **Search** matches the reference whole or in part, case-insensitively
  (`ORD-2026-00481`, unpadded `ORD-2026-481`, `ORD-2026`, `2026-004`); a bare
  number (`481`, `#481`) matches that number exactly, in any year; and the
  name and phone as on Customers.
- **Orders added by hand** are for a customer who has messaged the Page
  (`404 CUSTOMER_NOT_FOUND` otherwise). They start as `new` with
  `source = seller`, so stock moves on confirmation as for the assistant's.
  The non-negotiable "no order without explicit customer confirmation" binds
  the assistant: it never writes an order the customer didn't confirm. A
  seller entering one by hand is acting on an agreement made outside the
  assistant, which the domain allows; such an order has no `conversation_id`. Name, phone and address default to the customer's
  details on file; if one is missing it must be sent (`REQUIRED` on that
  field). The currency is the shop's. Creation takes the shop's settings row
  lock, which serializes the yearly number sequence, the idempotency check and the
  currency lock. With an `Idempotency-Key`, a repeat returns the first order.
- **A product that was ordered cannot be deleted** (`409 PRODUCT_IN_USE`):
  order lines keep foreign keys to their product and variant. The seller
  archives it instead.

## Data model

Schema in [`orders.ts`](../../../apps/api/src/modules/database/schema/orders.ts),
migrations `0020_orders` and `0021_orders_force_rls`; `0022`–`0025` moved
the number to a yearly sequence, renumbering existing orders within their
year by `placed_at`. Every table has RLS
enabled and forced with a `*_merchant_isolation` policy, and composite
`(merchant_id, id)` foreign keys.

- `order`: `year`, `number` (`UNIQUE (merchant_id, year, number)`),
  `reference` (`UNIQUE (merchant_id, reference)`), `customer_id`,
  `conversation_id` (nullable), `source`, `status`, `payment_status`,
  `payment_method`, `subtotal`, `delivery_fee`, `total`
  (`total = subtotal + delivery_fee`), `currency`, the delivery snapshot
  (`customer_name`, `phone`, `delivery_address`, `delivery_area`,
  `delivery_everywhere_else`, `delivery_time`), `delivery_charge_id` (→
  `delivery_charge`, `ON DELETE SET NULL (delivery_charge_id)`, migration
  `0027`),
  `tracking_number`, `notes` (internal), `revision`, `idempotency_key`
  (`UNIQUE (merchant_id, idempotency_key)`), `placed_at`. Indexed on
  `(merchant_id, placed_at DESC, id)`, `(merchant_id, status, placed_at DESC, id)`
  and `(merchant_id, customer_id, placed_at DESC, id)`.
- `order_item`: `order_id` (cascades), `product_id` → `product` and
  `variant_id` → `product_variant` with no ON DELETE action (null only on
  lines written before the keys), snapshots `product_name`, `variant_name`,
  `sku`, `unit_price`; `quantity` > 0, `position`.
- `order_event`: `order_id` (cascades), `type`, `data` jsonb (parsed with
  `orderEventDataSchema` on read; a check keeps `data->>'type' = type`),
  `actor_id` → `user.id` `ON DELETE SET NULL`, `created_at`.

## Errors

From [`order-errors.ts`](../../../apps/api/src/modules/orders/order-errors.ts),
plus the shared ones each route lists in Swagger.

| Code                        | Status | Params                           | When                                                                                 |
| --------------------------- | ------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| `ORDER_NOT_FOUND`           | 404    | `{ id }`                         | No such order for this merchant                                                      |
| `ORDER_STALE`               | 409    | `{ id }`                         | The `version` sent isn't the order's current one                                     |
| `ORDER_INVALID_TRANSITION`  | 409    | `{ from, to }`                   | A status move the lifecycle doesn't allow                                            |
| `ORDER_NOT_EDITABLE`        | 409    | `{ status }`                     | Items outside `new`/`confirmed`; delivery details outside `new`/`confirmed`/`packed` |
| `ORDER_INSUFFICIENT_STOCK`  | 409    | `{ variantId, name, available }` | Taking more of a variant than it has                                                 |
| `CUSTOMER_NOT_FOUND`        | 404    | `{ id }`                         | `POST /` for a customer who isn't the shop's                                         |
| `VARIANT_NOT_FOUND`         | 404    | `{ id }`                         | A new line's variant is unknown or archived                                          |
| `DELIVERY_CHARGE_NOT_FOUND` | 404    | `{ id }`                         | `POST /`, `PATCH /:id` or the quote names an area that isn't the shop's              |
| `PRODUCT_IN_USE`            | 409    | `{ id }`                         | Deleting a product an order line references (catalog route)                          |

Field codes under `400 VALIDATION_FAILED`: `REQUIRED` (a hand-made order
missing a name, phone or address the customer's record can't fill),
`DUPLICATE` (a variant on two lines), `INVALID_PHONE`.

## Web

- **`/`** redirects to `/orders` until the Overview page exists. The nav's
  Orders item counts the drafted orders waiting for the seller.
- **`/orders`**: the four cards (ignoring the filters), a banner while drafted
  orders wait, search, a date filter (all time, today, last 7 or 30 days, this
  month, or a custom range of the shop's calendar days, turned into instants
  in the shop's time zone), the status tabs with counts under the same search
  and dates, and a page of orders: a table from `md` up, sortable by total and
  date, and cards below it. The view lives in the URL (`status`, `q`,
  `range`, `from`, `to`, `sort`, `direction`, `page`, `pageSize`). "Create
  order" opens a dialog: pick a customer, add items, then delivery and
  payment, prefilled from the customer's details; picking an area fills in
  the fee from the quote, and changing the items re-quotes it unless the
  seller typed their own; it sends an
  `Idempotency-Key` made once per dialog and opens the new order.
- **`/orders/:id`**: the next step as the primary button (Confirm, Mark as
  packed, shipped, delivered), with Cancel and Mark as returned behind a
  confirmation that takes an optional reason. The buttons come from
  `canTransitionOrder`. Then the progress stepper, the items (an Edit items
  dialog while new or confirmed, with a product and variant picker), payment
  (Mark as paid, or an Edit dialog), the activity, the customer, delivery
  (area, charge and the estimate; an Edit dialog until shipped, where picking
  an area re-quotes the fee; the tracking number from packed), the chat's
  last three messages with a link to it, and the internal note.
- Every change sends the order's `version`. A `409` refetches the order, so
  the seller sees what changed; a success replaces the order with the answer
  and refreshes the lists, the activity, the catalog (stock) and Customers.
- The customer page's orders link to `/orders/:id`.

## Code and tests

`apps/api/src/modules/orders/`: `OrdersService` (create, status, items,
patch, under the row locks above), `order-rules.ts` (stock differences, line
snapshots, the PATCH plan), `order-reference.ts` (year and reference),
`OrdersRepository`, `OrderEventsRepository` and `OrderCatalogRepository` (the
variant and product locks). The lifecycle (`canTransitionOrder`,
`orderHoldsStock`) is in `@app/shared`, so the web shows the same buttons.

| Spec                                                                                                                               | Covers                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`orders/__tests__/order-rules.spec.ts`](../../../apps/api/src/modules/orders/__tests__/order-rules.spec.ts)                       | Stock differences, lock order, line snapshots, the PATCH plan                                               |
| [`orders/__tests__/delivery-quote.service.spec.ts`](../../../apps/api/src/modules/orders/__tests__/delivery-quote.service.spec.ts) | The fee: highest not sum, shop charge where a product sets none, the threshold, another shop's area         |
| [`orders/__tests__/order-reference.spec.ts`](../../../apps/api/src/modules/orders/__tests__/order-reference.spec.ts)               | The year in the shop's zone; padding and widening                                                           |
| [`orders/__tests__/orders.e2e.spec.ts`](../../../apps/api/src/modules/orders/__tests__/orders.e2e.spec.ts)                         | Every route over HTTP: stock, staleness, transitions, hand-made orders, numbering, search, `PRODUCT_IN_USE` |
| [`database/__tests__/orders-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/orders-schema.spec.ts)               | Keys, checks, yearly numbering, RLS for two merchants                                                       |

Web: `apps/web/src/features/orders/`, routes under
`apps/web/src/routes/_app/orders/`.

## Follow-ups

- The order summary in Messenger when the seller confirms ("When you confirm,
  Nusrat gets an order summary"): sent after the transaction commits, through
  the conversations send path, never inside it.
- The assistant writing `source = assistant` orders from a confirmed
  conversation, idempotent per confirmation.
- CSV export of the filtered list.
- Report each assistant order with `NotificationsService.orderDrafted` once
  it commits, so the seller gets its email
  ([Settings – Notifications](../10-settings-notifications/README.md#sending)).
