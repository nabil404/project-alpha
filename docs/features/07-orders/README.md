# 07 · Orders

The seller's order desk: a list with stat cards and status tabs, and a page
per order where the seller moves it through its lifecycle, edits items and
delivery details, records payment and tracking, and reads its activity.
Scope comes from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md)
and [data model](../../mvp/01-messenger-to-order/domain.md#data-model).

**Status (Oct 2026):** built in the API and at `/orders` and `/orders/:id`.
The assistant writes `source = assistant` orders when the customer taps
Confirm on its summary card
([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#confirm)).
Not built: CSV export, and the order summary sent to the customer when the
seller confirms. See [Follow-ups](#follow-ups).

[Order lifecycle](lifecycle.md) draws the statuses, when stock moves, and
what can change in each status.

## Routes (`/api/v1/orders`, session + TenantGuard)

On every `:id` route, a non-UUID id is `400 VALIDATION_FAILED`, and an unknown
id or another shop's is `404 ORDER_NOT_FOUND`. Every change sends the
`version` it read, and a change from an older read is `409 ORDER_STALE`.

| Route                  | Request                                                                                                                                                                                | Response                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `GET /`                | `status` (`all` default, or an order status), `q` ≤ 100, `from`, `to` (instants), `sort` (`placed_at` default, `total`), `direction` (`desc` default), `page`, `pageSize` 10/25/50/100 | `{ data: OrderListItem[], pagination }`      |
| `GET /summary`         | `q`, `from`, `to`                                                                                                                                                                      | `OrderSummary`                               |
| `POST /`               | `CreateOrder`, optional `Idempotency-Key` header (≤ 200 characters)                                                                                                                    | 201 `OrderDetail`                            |
| `GET /:id`             | none                                                                                                                                                                                   | `OrderDetail`                                |
| `GET /:id/activity`    | none                                                                                                                                                                                   | `OrderEvent[]`, newest first, not paginated  |
| `POST /:id/status`     | `{ status, note?, version }`. `note` is the reason kept on the activity, not the order's internal note                                                                                 | 200 `OrderDetail`                            |
| `PUT /:id/items`       | `{ items: [{ variantId, quantity, unitPrice? }], version }`                                                                                                                            | 200 `OrderDetail`                            |
| `PATCH /:id`           | `{ customerName?, phone?, deliveryAddress?, deliveryArea?, deliveryChargeId?, deliveryFee?, paymentStatus?, paymentMethod?, trackingNumber?, note?, version }`                         | 200 `OrderDetail`                            |
| `POST /delivery-quote` | `{ deliveryChargeId, items: [{ variantId, quantity, unitPrice? }] }`. Writes nothing                                                                                                   | 200 `{ fee, subtotal, freeDeliveryApplied }` |

The shapes are the Zod schemas in
[`packages/shared/src/schemas/order.ts`](../../../packages/shared/src/schemas/order.ts).
Money is integer minor units of the order's `currency`, and timestamps are ISO
strings.

- **Reference.** The API assigns `reference` when the order is placed, for
  example `ORD-2026-00481`. `year` is the calendar year in the shop's time
  zone, and `number` counts the shop's orders from 1 within that year, padded
  to five digits and wider past them (`ORD-2026-100000`).
- `OrderListItem`: reference, number, year, source, status, payment status
  and method, `customer { id, name, phone }` as placed, `firstItem` and
  `itemCount`, total, currency and `placedAt`.
- `OrderSummary`: `counts` per tab under the list's `q`, `from` and `to`, so
  the tabs agree with the table. The cards ignore those filters:
  `awaitingConfirmation` (orders in `new`), `toShip { confirmed, packed }`,
  `revenue { currentWindow, previousWindow }` over rolling 30-day windows, and
  `placedInWindow { all, byAssistant }`.
- `OrderDetail`: the order with `version`, `nextStatuses` (the buttons to
  show), lines with SKU and `lineTotal`, `deliveryFee`,
  `delivery { name, phone, address, area, chargeId, everywhereElse, time }`,
  `trackingNumber`, `note` (internal), `customer { id, name, pictureUrl, earlierOrderCount, spentBefore }`,
  and `conversationId` (null for an order the seller added).
- `OrderEvent`: `{ id, data, actor | null, createdAt }`. `data.type` is
  `created`, `status_changed` (with the seller's note), `items_changed`
  (totals before and after), `delivery_changed` (which of `name`, `phone`,
  `address`, `area`, `fee`), `payment_changed` or `tracking_changed`. Older
  events that say `zone` and `charge` read as `area` and `fee`. Editing the
  internal note records no event. `actor` is null for the assistant and for
  a deleted account.

## Rules

- **Lifecycle.** `new → confirmed → packed → shipped → delivered → returned`,
  and `cancelled` from any status before `delivered`. The design's "Drafted"
  is `new`: the customer confirmed in Messenger and the seller confirms again
  on the dashboard. `canTransitionOrder` in `@app/shared` holds the moves;
  any other is `409 ORDER_INVALID_TRANSITION` with `from` and `to`.
- **Stock** is held while the order is `confirmed`, `packed`, `shipped` or
  `delivered` (`orderHoldsStock`). A status move or an item edit takes or
  returns the difference per variant. Taking more than a variant has is
  `409 ORDER_INSUFFICIENT_STOCK` with `variantId`, `name` and `available`, and
  nothing changes. `lockAndBumpProducts` locks the products in id order
  before touching variants, as the product save does, so the two never
  deadlock. It also bumps each product's revision, so an open product edit
  page sees the change.
- **Items** change only while the order is `new` or `confirmed`
  (`409 ORDER_NOT_EDITABLE` after). A variant already on the order keeps its
  name, SKU and price, even if archived since. A new variant must be live and
  takes the catalog price. `unitPrice` overrides either. Each variant appears
  once (`DUPLICATE`), on 1 to 50 lines.
- **Delivery details** (name, phone, address, area, fee) change until the
  order ships. Payment, tracking number and the note change at any time. They
  are the order's own copy, and the customer's record never changes with
  them. A PATCH that changes nothing keeps the version.
- **Delivery area.** `deliveryChargeId` links one of the shop's
  [delivery charges](../09-settings-delivery/README.md) and copies onto the
  order its area name (unless `deliveryArea` is sent), whether it is
  everywhere else, and its delivery time. `null` unlinks and clears all three.
  Removing the area in Settings keeps the copies and clears the link. Another
  shop's id is `404 DELIVERY_CHARGE_NOT_FOUND`. A typed `deliveryArea` with no
  link still works.
- **Delivery fee** is stored as sent and never recomputed. It is required on
  `POST /`, can change until the order ships, and stays when items change. A
  check enforces `total = subtotal + delivery_fee`. The dashboard prefills
  the fee from `POST /delivery-quote`, which runs `deliveryFeeFor` from
  `@app/shared`, the same rule the assistant quotes with:
  - each product's own charge for the area, or the shop's where it sets none;
  - the highest of those, not the sum;
  - zero once the subtotal reaches the free-delivery threshold.

  The quote prices items at the sent price, else the catalog's, and archived
  variants still quote.

- **Payment** is the seller's record only: `unpaid`, `paid`, `refunded`, and
  `cash_on_delivery`, `bank_transfer`, `mobile_wallet`. The MVP takes no
  payments.
- **Revenue and customer figures** leave out `cancelled` and `returned`
  orders.
- **Dates.** `from` is inclusive, `to` exclusive, and `from` must be before
  `to`. The page turns "Today" or "This month" into instants in the shop's
  time zone.
- **Search** matches:
  - the reference, whole or in part, case-insensitively (`ORD-2026-00481`,
    unpadded `ORD-2026-481`, `ORD-2026`, `2026-004`);
  - a bare number (`481`, `#481`) as that exact number in any year;
  - the name and phone the order was placed with, as on Customers.
- **Orders added by hand** need a customer who has messaged the Page
  (`404 CUSTOMER_NOT_FOUND` otherwise). They start as `new` with
  `source = seller` and no `conversation_id`. Name, phone and address default
  to the customer's details on file, and a missing one must be sent
  (`REQUIRED`). The rule "no order without explicit customer confirmation"
  binds the assistant; a seller adding an order acts on an agreement made
  outside it. A repeat with the same `Idempotency-Key` returns the first
  order.
- **Creation is serialized.** `createInTransaction` first locks the shop's
  `merchant_settings` row. That lock guards the yearly number, the
  idempotency check, and the currency copied onto the order.
- **Orders the assistant drafts** come only from the Confirm button on its
  summary card. They go through the same `createInTransaction`, inside the
  assistant's transaction, with `source = assistant`, the conversation's id, a
  null actor, and the idempotency key `assistant:<conversationId>:<revision>`,
  so one card makes at most one order.
- **An ordered product cannot be deleted** (`409 PRODUCT_IN_USE`), because
  order lines keep foreign keys to the product and variant. The seller
  archives it instead.

## Data model

[`orders.ts`](../../../apps/api/src/modules/database/schema/orders.ts).
Migrations `0020` and `0021` create the tables, and `0022`–`0025` moved the
number to a yearly sequence, renumbering existing orders within their year by
`placed_at`. Each table has RLS enabled and forced with a
`*_merchant_isolation` policy, and references its parent by
`(merchant_id, id)`.

- `order`: `year`, `number` (`UNIQUE (merchant_id, year, number)`),
  `reference` (unique per shop), `customer_id`, `conversation_id` (nullable),
  `source`, `status`, `payment_status`, `payment_method`, `subtotal`,
  `delivery_fee`, `total`, `currency`, the delivery copy (`customer_name`,
  `phone`, `delivery_address`, `delivery_area`, `delivery_everywhere_else`,
  `delivery_time`), `delivery_charge_id`, `tracking_number`, `notes`
  (internal), `revision`, `idempotency_key` (unique per shop) and
  `placed_at`.
  - `delivery_charge_id` references `delivery_charge` with
    `ON DELETE SET NULL (delivery_charge_id)`, written by hand in migration
    `0027`.
  - Indexes on `(merchant_id, placed_at DESC, id)`, with `status`,
    `customer_id` or `conversation_id` after `merchant_id` (the last from
    migration `0035`, for a chat's latest order), and on
    `(merchant_id, delivery_charge_id)`.
- `order_item`: `order_id` (cascades), `product_id` and `variant_id` with no
  `ON DELETE` action (null only on lines written before the keys), copies of
  `product_name`, `variant_name`, `sku` and `unit_price`, `quantity` > 0, and
  `position`.
- `order_event`: `order_id` (cascades), `type`, `data` jsonb (parsed with
  `orderEventDataSchema` on read; a check keeps `data->>'type' = type`),
  `actor_id` → `user.id` `ON DELETE SET NULL`, and `created_at`.

## Errors

From [`order-errors.ts`](../../../apps/api/src/modules/orders/order-errors.ts),
plus the shared ones each route lists in Swagger.

| Code                        | Status | Params                           | When                                                                                 |
| --------------------------- | ------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| `ORDER_NOT_FOUND`           | 404    | `{ id }`                         | No such order for this shop                                                          |
| `ORDER_STALE`               | 409    | `{ id }`                         | The `version` sent is not the order's current one                                    |
| `ORDER_INVALID_TRANSITION`  | 409    | `{ from, to }`                   | A status move the lifecycle does not allow                                           |
| `ORDER_NOT_EDITABLE`        | 409    | `{ status }`                     | Items outside `new`/`confirmed`; delivery details outside `new`/`confirmed`/`packed` |
| `ORDER_INSUFFICIENT_STOCK`  | 409    | `{ variantId, name, available }` | Taking more of a variant than it has                                                 |
| `CUSTOMER_NOT_FOUND`        | 404    | `{ id }`                         | `POST /` for a customer who is not the shop's                                        |
| `VARIANT_NOT_FOUND`         | 404    | `{ id }`                         | A new line's variant is unknown or archived; the quote names an unknown variant      |
| `DELIVERY_CHARGE_NOT_FOUND` | 404    | `{ id }`                         | `POST /`, `PATCH /:id` or the quote names an area that is not the shop's             |
| `PRODUCT_IN_USE`            | 409    | `{ id }`                         | Deleting a product an order line references (catalog route)                          |

Field codes under `400 VALIDATION_FAILED`: `REQUIRED` (a hand-made order
missing a name, phone or address the customer's record cannot fill),
`DUPLICATE` (a variant on two lines) and `INVALID_PHONE`.

## Web

- **`/`** redirects to `/orders` until the Overview page exists. The nav's
  Orders item counts orders waiting in `new`.
- **`/orders`** shows the four cards, a banner while drafted orders wait,
  search, a date filter, the status tabs with counts, and a page of orders.
  - The date filter offers all time, today, last 7 or 30 days, this month, or
    a custom range of the shop's calendar days, sent as instants in the
    shop's time zone.
  - From `md` up the list is a table sortable by total and date; below `md`
    it is a list of cards.
  - The URL holds `status`, `q`, `range`, `from`, `to`, `sort`, `direction`,
    `page` and `pageSize`.
- **Create order** is a dialog: pick a customer, add items, then delivery and
  payment, prefilled from the customer's details. Picking an area fills the
  fee from the quote, and changing items re-quotes it unless the seller typed
  a fee. The dialog makes one `Idempotency-Key` and opens the new order.
- **`/orders/:id`** shows:
  - the next step as the primary button (Confirm, Mark as packed, shipped,
    delivered), with Cancel and Mark as returned behind a confirmation that
    takes an optional reason;
  - the progress stepper and the items, with an Edit items dialog while
    `new` or `confirmed`;
  - payment (Mark as paid, or an Edit dialog) and the activity;
  - the customer, and delivery with an Edit dialog until shipped (picking an
    area re-quotes the fee) and the tracking number from `packed`;
  - the chat's last three messages with a link to it, and the internal note.
- **After a change**, a `409` refetches the order so the seller sees what
  changed. A success replaces the order and refreshes the lists, the
  activity, the catalog (stock) and Customers.

## Code and tests

`apps/api/src/modules/orders/`:

- `OrdersService`: create, status, items and patch, under the locks above.
- `order-rules.ts`: stock differences, line copies and the PATCH plan.
- `order-reference.ts`: the year and reference.
- `DeliveryQuoteService`: the quote.
- `OrdersRepository`, `OrderEventsRepository`, and `OrderCatalogRepository`
  (variant and product locks).

The lifecycle (`canTransitionOrder`, `orderHoldsStock`) lives in
`@app/shared`, so the web shows the same buttons.

| Spec                                                                                                                               | Covers                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`orders/__tests__/order-rules.spec.ts`](../../../apps/api/src/modules/orders/__tests__/order-rules.spec.ts)                       | Stock differences, lock order, line copies, the PATCH plan                                                  |
| [`orders/__tests__/delivery-quote.service.spec.ts`](../../../apps/api/src/modules/orders/__tests__/delivery-quote.service.spec.ts) | The fee: highest not sum, shop charge where a product sets none, the threshold, another shop's area         |
| [`orders/__tests__/order-reference.spec.ts`](../../../apps/api/src/modules/orders/__tests__/order-reference.spec.ts)               | The year in the shop's zone; padding and widening                                                           |
| [`orders/__tests__/orders.e2e.spec.ts`](../../../apps/api/src/modules/orders/__tests__/orders.e2e.spec.ts)                         | Every route over HTTP: stock, staleness, transitions, hand-made orders, numbering, search, `PRODUCT_IN_USE` |
| [`database/__tests__/orders-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/orders-schema.spec.ts)               | Keys, checks, yearly numbering, RLS for two merchants                                                       |

Web: `apps/web/src/features/orders/` and `apps/web/src/routes/_app/orders/`.

## Follow-ups

- Send the customer an order summary in Messenger when the seller confirms
  ("When you confirm, Nusrat gets an order summary"). Send it after the
  transaction commits, through the conversations send path.
- CSV export of the filtered list.
