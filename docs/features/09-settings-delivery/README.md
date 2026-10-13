# 09 · Settings – Delivery charges

What delivery costs and how long it takes, per area the shop names, plus
"Everywhere else" for an address that matches none, and an optional
free-delivery threshold. A product can set its own charge per area, and an
order records the area it went to.

**Status (Oct 2026):** built: the API, `/settings/delivery`, the product
edit page's Delivery charge card, and the area picker and fee quote on
orders. The assistant matches a customer's address to an area and quotes the
fee with the same `deliveryFeeFor` rule
([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#matching)).

## Routes (session + TenantGuard)

| Route                                | Request                                                                                                                                | Response                                     | Errors                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/v1/settings/delivery`      | none                                                                                                                                   | `DeliverySettings`                           | none                                                                           |
| `PUT /api/v1/settings/delivery`      | `{ deliveryCharges: [{ id?, areaName, charge, deliveryTime? }], everywhereElse: { charge, deliveryTime? }, freeDeliveryOver }`, strict | 200 `DeliverySettings`                       | 400 `VALIDATION_FAILED`, 404 `DELIVERY_CHARGE_NOT_FOUND`                       |
| `POST /api/v1/orders/delivery-quote` | `{ deliveryChargeId, items: [{ variantId, quantity, unitPrice? }] }`. Writes nothing                                                   | 200 `{ fee, subtotal, freeDeliveryApplied }` | 400 `VALIDATION_FAILED`, 404 `DELIVERY_CHARGE_NOT_FOUND` / `VARIANT_NOT_FOUND` |

`DeliverySettings` is `{ currency, deliveryCharges: [{ id, areaName, charge, deliveryTime | null }], everywhereElse: { id, charge, deliveryTime | null } | null, freeDeliveryOver | null }`,
in [`packages/shared/src/schemas/delivery.ts`](../../../packages/shared/src/schemas/delivery.ts).
Amounts are minor units of `currency`. Products carry `customDelivery` and
`deliveryCharges` ([Catalog](../02-catalog/README.md#the-product-document)),
and orders carry `deliveryChargeId` and
`delivery { area, chargeId, everywhereElse, time }`
([Orders](../07-orders/README.md#rules)).

## Rules

- **Areas are free text**, written the way customers write them: a city, a
  neighbourhood or a postcode. No library covered neighbourhoods and
  postcodes everywhere: `country-state-city` (GPL-3.0, 17 MB),
  `all-the-cities` (cities only) and `@bangladeshi/bangladesh-address`
  (Bangladesh only) were evaluated and rejected.
- **Names** are trimmed with inner whitespace collapsed, at most 100
  characters, without control characters, and unique per shop ignoring case.
  A repeat is `DUPLICATE` at `deliveryCharges.<i>.areaName`, and a unique
  index backs it. A shop has at most 100 areas. A delivery time is at most 40
  characters, and a blank one clears it.
- **Everywhere else** is one row per shop that cannot be removed. A shop that
  has never saved has none (`everywhereElse: null`), and the first save must
  set its charge.
- **The page saves as one document.**
  - A row with an `id` is updated and a row without one is added. A named row
    left out is removed along with every product's charge for it.
  - Orders delivered to a removed area keep its name, flag and estimate and
    lose only the link.
  - An `id` that is not one of the shop's is `DELIVERY_CHARGE_NOT_FOUND`, and
    nothing changes.
  - Areas keep the order they were listed in.
  - Renames happen in two steps, so two areas can swap names without
    breaking the unique index.
  - The save locks the shop's `merchant_settings` row. The last save wins, as
    on Settings – General.
- **The fee** (`deliveryFeeFor`):
  - each product costs its own charge for the area if it sets one, else the
    shop's (also for a custom product with no charge for a newer area);
  - the order pays the highest, not the sum;
  - the fee is zero when the subtotal is at or over `freeDeliveryOver`.
- **Orders** store the fee the dashboard sends and never recompute it. The
  dashboard fills it from the quote.
- **Currency.** A change before the first order rescales area charges,
  products' own charges and the threshold along with the prices
  ([Settings – General](../06-settings-general/README.md#rules)).

## Data model

- `delivery_charge`: `area_name` (null only on the everywhere-else row),
  `is_fallback`, `charge`, `delivery_time` and `position`. Unique on
  `(merchant_id, lower(area_name))` among named rows, and one fallback row per
  shop.
- `product_delivery_charge`: `(product_id, delivery_charge_id)` and `charge`.
  Both keys cascade.
- `product.custom_delivery` and `merchant_settings.free_delivery_over`.
- On `order`: `delivery_fee` (formerly `delivery_charge`), `delivery_area`
  (formerly `delivery_zone`), `delivery_charge_id`,
  `delivery_everywhere_else` and `delivery_time`.

Migration `0026_settings_delivery` creates them. Migration
`0027_delivery_charge_force_rls` forces RLS on both tables and adds
`order_delivery_charge_fk` with `ON DELETE SET NULL (delivery_charge_id)`.
See [database.md](../../architecture/database.md).

## Dashboard

- **`/settings/delivery`** lists the areas (a table from `md` up, a card per
  area below it) with name, charge, time and a remove button, then the fixed
  Everywhere else row, Add area, and Free delivery over (empty means always
  charge). One Save and Cancel cover the page.
- **Product edit page.** The Delivery charge card offers "Use shop charges"
  or "Custom charge for this product". The custom option lists every area
  with the shop charge beside an input, and an empty input uses the shop
  charge. The design's product-level "Free delivery" option was left out on
  purpose.
- **Orders.** Create order and the Delivery card's Edit dialog pick the area
  from a list (the areas, Everywhere else, No area), and picking one fills the
  fee from the quote. With no areas set up, the area is free text with a link
  to this page. The Delivery card shows the area, the charge and "Estimated …
  after shipping".

## Code and tests

- API: `DeliverySettingsService`, `DeliveryChargesRepository` and
  `delivery-settings.controller.ts` in `apps/api/src/modules/settings/`;
  `products/product-delivery.repository.ts`; `orders/delivery-quote.service.ts`.
- Web: `features/settings/components/DeliveryChargesCard.tsx`,
  `features/catalog/components/DeliveryChargeCard.tsx` and
  `features/orders/components/AreaField.tsx`, under `apps/web/src/`.

| Spec                                                                                                                                         | Covers                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`settings/__tests__/delivery-rules.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-rules.spec.ts)                       | Name normalizing, duplicates, the save schema, `deliveryFeeFor`                          |
| [`settings/__tests__/delivery-settings.service.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-settings.service.spec.ts) | Save and read, ids kept, swaps, another shop's id, removal unlinking orders and products |
| [`settings/__tests__/delivery-settings.e2e.spec.ts`](../../../apps/api/src/modules/settings/__tests__/delivery-settings.e2e.spec.ts)         | The routes over HTTP and their errors                                                    |
| [`database/__tests__/delivery-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/delivery-schema.spec.ts)                     | Indexes, checks, RLS, the `SET NULL` and cascading keys                                  |
| [`orders/__tests__/delivery-quote.service.spec.ts`](../../../apps/api/src/modules/orders/__tests__/delivery-quote.service.spec.ts)           | The fee rule against the database                                                        |

## Follow-ups

- The assistant quotes the fee but not the area's delivery time.
- A stale-save guard (`version`) for two people editing the page at once.
- A place lookup for area names, if free text proves too loose.
- Once a shop has teammates, only the owner should change these settings.
