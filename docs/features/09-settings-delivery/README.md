# 09 · Settings – Delivery charges

What delivery costs and how long it takes, per area the shop names, plus
"Everywhere else" for an address that matches none, and an optional
free-delivery threshold. A product can set its own charge per area, and an
order records the area it was delivered to. The screens are the
Settings – Delivery charges artboards in the design canvas, the Product edit
page's Delivery charge card and the Order detail's Delivery card.

**Status (Oct 2026):** built: the API, the page at `/settings/delivery`, the
product card, and the area picker and fee quote on orders. The assistant
quoting delivery is for the AI work.

## Routes (session + TenantGuard)

| Route                                | Request                                                                                                                                | Response                                     | Errors                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/v1/settings/delivery`      | —                                                                                                                                      | `DeliverySettings`                           | —                                                                              |
| `PUT /api/v1/settings/delivery`      | `{ deliveryCharges: [{ id?, areaName, charge, deliveryTime? }], everywhereElse: { charge, deliveryTime? }, freeDeliveryOver }`, strict | 200 `DeliverySettings`                       | 400 `VALIDATION_FAILED`, 404 `DELIVERY_CHARGE_NOT_FOUND`                       |
| `POST /api/v1/orders/delivery-quote` | `{ deliveryChargeId, items: [{ variantId, quantity, unitPrice? }] }`; writes nothing                                                   | 200 `{ fee, subtotal, freeDeliveryApplied }` | 400 `VALIDATION_FAILED`, 404 `DELIVERY_CHARGE_NOT_FOUND` / `VARIANT_NOT_FOUND` |

`DeliverySettings` is `{ currency, deliveryCharges: [{ id, areaName, charge, deliveryTime | null }], everywhereElse: { id, charge, deliveryTime | null } | null, freeDeliveryOver | null }`,
in [`packages/shared/src/schemas/delivery.ts`](../../../packages/shared/src/schemas/delivery.ts).
Amounts are minor units of `currency`. Products carry `customDelivery` and
`deliveryCharges` ([Catalog](../02-catalog/README.md#the-product-document));
orders carry `deliveryChargeId` and `delivery { area, chargeId, everywhereElse, time }`
([Orders](../07-orders/README.md#rules)).

## Rules

- **Areas are free text**, written the way customers write them (a city, a
  neighbourhood, a postcode). There is no place lookup: `country-state-city`
  (GPL-3.0, 17 MB), `all-the-cities` (cities only) and
  `@bangladeshi/bangladesh-address` (Bangladesh only) were evaluated, and none
  covers neighbourhoods or postcodes everywhere.
- **Names** are trimmed, inner spaces collapsed, control characters refused,
  at most 100 characters, and unique per shop ignoring case: a repeat is
  `DUPLICATE` at `deliveryCharges.<i>.areaName`, backed by a unique index. At
  most 100 areas; a delivery time is at most 40 characters, blank clears it.
- **Everywhere else** is one row per shop that can't be removed. A shop that
  has never saved has none (`everywhereElse: null`), and the first save
  requires its charge.
- **The page saves as one document.** A row with an `id` is updated, one
  without is added, and a named row left out is removed, with every product's
  charge for it; orders delivered there keep their area name, flag and
  estimate and lose only the link. An `id` that isn't one of the shop's →
  `DELIVERY_CHARGE_NOT_FOUND`, and nothing changes. Areas keep the order they
  were listed in. Renames are written in two steps so two areas can swap
  names. The save holds the shop's settings row lock; the last save wins, as
  on Settings – General.
- **The fee** (`deliveryFeeFor`): each product in the order costs its own
  charge for the area if it sets one, else the shop's; the order pays the
  **highest**, not the sum; and nothing once the subtotal is at or over
  `freeDeliveryOver`. A custom product with no charge for an area (one added
  later, say) pays the shop's.
- **Orders** store the fee the dashboard sends and never recompute it; the
  dashboard fills it in from the quote.
- **Currency.** A change before the first order rescales area charges,
  products' own charges and the threshold with the prices
  ([Settings – General](../06-settings-general/README.md#rules)).

## Data model

- `delivery_charge`: `area_name` (null only on the everywhere-else row),
  `is_fallback`, `charge`, `delivery_time`, `position`. Unique
  `(merchant_id, lower(area_name))` among named rows and one fallback per shop.
- `product_delivery_charge`: `(product_id, delivery_charge_id)`, `charge`;
  both keys cascade.
- `product.custom_delivery`, `merchant_settings.free_delivery_over`.
- On `order`: `delivery_fee` (was `delivery_charge`), `delivery_area` (was
  `delivery_zone`), `delivery_charge_id`, `delivery_everywhere_else`,
  `delivery_time`.

Migrations `0026_settings_delivery` and `0027_delivery_charge_force_rls`
(`FORCE` RLS on both tables, and `order_delivery_charge_fk` with
`ON DELETE SET NULL (delivery_charge_id)`). Details in
[database.md](../../architecture/database.md).

## Dashboard

- **`/settings/delivery`**: the areas as rows (a table from `md` up, a card
  per area below it) with name, charge and time, a remove button, the fixed
  Everywhere else row, Add area, and Free delivery over (empty: always
  charge). One Save and Cancel for the page.
- **Product edit page**: the Delivery charge card, "Use shop charges" (with a
  summary of the first areas) or "Custom charge for this product", which
  lists every area with its shop charge beside an input; an empty input uses
  the shop charge. The design's product-level "Free delivery" option is not
  built, by decision.
- **Orders**: Create order and the Delivery card's Edit dialog pick the area
  from a list (areas, Everywhere else, No area); picking one fills in the fee
  from the quote, and in Create order a change to the items re-quotes it
  unless the seller typed their own fee. With no areas set up, the area is
  free text with a link here. The Delivery card shows the area, the charge
  and "Estimated … after shipping".

## Code and tests

`apps/api/src/modules/settings/`: `DeliverySettingsService`,
`DeliveryChargesRepository`, `delivery-settings.controller.ts`.
`apps/api/src/modules/products/product-delivery.repository.ts`,
`apps/api/src/modules/orders/delivery-quote.service.ts`. Web:
`apps/web/src/features/settings/components/DeliveryChargesCard.tsx`,
`apps/web/src/features/catalog/components/DeliveryChargeCard.tsx`,
`apps/web/src/features/orders/components/AreaField.tsx`.

| Spec                                                                                                                                         | Covers                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`settings/__tests__/delivery-rules.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-rules.spec.ts)                       | Name normalizing, duplicates, the save schema, `deliveryFeeFor`                          |
| [`settings/__tests__/delivery-settings.service.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-settings.service.spec.ts) | Save and read, ids kept, swaps, another shop's id, removal unlinking orders and products |
| [`settings/__tests__/delivery-settings.e2e.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-settings.e2e.spec.ts)         | The routes over HTTP and their errors                                                    |
| [`database/__tests__/delivery-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/delivery-schema.spec.ts)                     | Indexes, checks, RLS, the `SET NULL` and cascading keys                                  |
| [`orders/__tests__/delivery-quote.service.spec.ts`](../../../apps/api/src/modules/orders/__tests__/delivery-quote.service.spec.ts)           | The fee rule against the database                                                        |

## Follow-ups

- The assistant matching a customer's address to an area or Everywhere else
  and quoting with `DeliveryQuoteService.feeFor` and the delivery time; the
  MVP rules let it quote only the seller's charges.
- A stale-save guard (`version`) if two people edit the page at once.
- A place lookup for area names, if free text proves too loose.
- Only the owner should change these once a shop has teammates.
