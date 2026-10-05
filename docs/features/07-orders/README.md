# 07 · Orders

The seller's order desk: a list with stat cards and status tabs, and a page
per order where the seller confirms, packs, ships and delivers it, edits its
items and delivery details, records payment and tracking, and reads its
activity. Scope comes from the MVP's
[scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model); the screens
are the Orders and Order detail artboards in the design canvas. This page
describes what is built.

**Status (Oct 2026):** the API is built. Not built yet: the dashboard pages,
CSV export, the order summary sent to the customer in Messenger on
confirmation, and the assistant's own order creation (the conversation flow
will write `source = assistant` orders). See [Follow-ups](#follow-ups).

## Routes (`/api/v1/orders`, session + TenantGuard)

A non-UUID `:id` is `400 VALIDATION_FAILED`; an unknown id, or another shop's,
is `404 ORDER_NOT_FOUND` (never 403), on every `:id` route. Every change takes
the `version` the page read; a change from an older read is
`409 ORDER_STALE`, as the product edit page's is.

| Route               | Request                                                                                                                                                                                | Response                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /`             | `status` (`all` default, or an order status), `q` ≤ 100, `from`, `to` (instants), `sort` (`placed_at` default, `total`), `direction` (`desc` default), `page`, `pageSize` 10/25/50/100 | `{ data: OrderListItem[], pagination }`     |
| `GET /summary`      | `q`, `from`, `to`                                                                                                                                                                      | `OrderSummary`                              |
| `POST /`            | `CreateOrder`, optional `Idempotency-Key` header                                                                                                                                       | 201 `OrderDetail`                           |
| `GET /:id`          | —                                                                                                                                                                                      | `OrderDetail`                               |
| `GET /:id/activity` | —                                                                                                                                                                                      | `OrderEvent[]`, newest first, not paginated |
| `POST /:id/status`  | `{ status, note?, version }`                                                                                                                                                           | 200 `OrderDetail`                           |
| `PUT /:id/items`    | `{ items: [{ variantId, quantity, unitPrice? }], version }`                                                                                                                            | 200 `OrderDetail`                           |
| `PATCH /:id`        | `{ customerName?, phone?, deliveryAddress?, deliveryZone?, deliveryCharge?, paymentStatus?, paymentMethod?, trackingNumber?, note?, version }`                                         | 200 `OrderDetail`                           |

Shapes are the Zod schemas in
[`packages/shared/src/schemas/order.ts`](../../../packages/shared/src/schemas/order.ts).
Money is integer minor units of the order's `currency`; timestamps are ISO
strings. `number` is the shop's sequence as an integer; the web formats it
(`ORD-2026-00481`).

- `OrderListItem`: number, source, status, payment, the customer's id with the
  name and phone the order was placed with, the first line and `itemCount`
  ("Blue kurti, M × 2 +1 more"), total, currency, `placedAt`.
- `OrderSummary`: `counts` per tab under the same `q`, `from` and `to` as the
  list, so the tabs agree with the table; and cards that ignore them:
  `awaitingConfirmation` (the "Drafted" orders, whenever placed), `toShip`
  (`confirmed`, `packed`), `revenue` over the last 30 days and the 30 before,
  and `placedInWindow` (`all`, `byAssistant`) for "Drafted by the assistant
  71%".
- `OrderDetail`: the order with `version`, `nextStatuses` (the buttons to
  show), lines with SKU and `lineTotal`, `delivery { name, phone, address,
zone }`, `trackingNumber`, `note`, `customer { id, name, pictureUrl,
earlierOrderCount, spentBefore }` ("Repeat customer · 2 earlier orders"),
  and `conversationId` for "Open chat" (null for an order the seller added).
- `OrderEvent`: `{ id, data, actor: { id, name } | null, createdAt }`, where
  `data` is one of `created`, `status_changed` (with the seller's note),
  `items_changed` (totals before and after), `delivery_changed` (which
  fields), `payment_changed` and `tracking_changed`. `actor` is null for the
  assistant.

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
- **Delivery details** (name, phone, address, zone, charge) change until the
  order ships; payment, tracking number and the note at any time. They are the
  order's own snapshot: the customer's record never changes. A field sent back
  unchanged is no change, and a PATCH that changes nothing keeps the version.
- **Payment** is the seller's record only (`unpaid`, `paid`, `refunded`;
  `cash_on_delivery`, `bank_transfer`, `mobile_wallet`); the MVP takes no
  payments.
- **Revenue and customer figures** leave out `cancelled` and `returned`
  orders. The windows are rolling 30 days, as on Customers.
- **Dates:** `from` is inclusive and `to` exclusive. The page turns "Today" or
  "This month" into instants in the shop's time zone, so the API never
  guesses one; `from` must be before `to`.
- **Search** matches the order number (`481`, `#481` or `ORD-2026-00481`), and
  the name and phone as on Customers.
- **Orders added by hand** are for a customer who has messaged the Page. They
  start as `new` with `source = seller`, so stock moves on confirmation as
  for the assistant's. Name, phone and address default to the customer's
  details on file; if one is missing it must be sent (`REQUIRED` on that
  field). The currency is the shop's. Creation takes the shop's settings row
  lock, which serializes the number sequence, the idempotency check and the
  currency lock. With an `Idempotency-Key`, a repeat returns the first order.
- **A product that was ordered cannot be deleted** (`409 PRODUCT_IN_USE`):
  order lines keep foreign keys to their product and variant. The seller
  archives it instead.

## Data model

Schema in [`orders.ts`](../../../apps/api/src/modules/database/schema/orders.ts),
migrations `0020_orders` and `0021_orders_force_rls`. Every table has RLS
enabled and forced with a `*_merchant_isolation` policy, and composite
`(merchant_id, id)` foreign keys.

- `order`: `number` (`UNIQUE (merchant_id, number)`), `customer_id`,
  `conversation_id` (nullable), `source`, `status`, `payment_status`,
  `payment_method`, `subtotal`, `delivery_charge`, `total`
  (`total = subtotal + delivery_charge`), `currency`, the delivery snapshot
  (`customer_name`, `phone`, `delivery_address`, `delivery_zone`),
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

## Follow-ups

- The dashboard pages at `/orders` and `/orders/:id`.
- The order summary in Messenger when the seller confirms ("When you confirm,
  Nusrat gets an order summary"): sent after the transaction commits, through
  the conversations send path, never inside it.
- The assistant writing `source = assistant` orders from a confirmed
  conversation, idempotent per confirmation.
- CSV export of the filtered list.
- Delivery zones as a shop setting; until then `delivery_zone` is free text.
