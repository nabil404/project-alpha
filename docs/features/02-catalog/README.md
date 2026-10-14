# 02 · Product catalog

How a seller's products, options, variants, categories and photos are stored,
kept consistent, and read by the dashboard and the assistant. Scope comes
from the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model).

**Status (Oct 2026):** built, except CSV import ([Not yet built](#not-yet-built)):
eight tables, the category and product services with the assistant's
`findSellableCatalog` read, product routes that save options and variants as
one versioned document, images on Cloudflare R2 with a daily orphan sweep,
and the dashboard's products list, edit page and Categories page. Orders move
stock ([Orders](../07-orders/README.md#rules)).

## At a glance

| Concern          | Decision                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables           | `product`, `product_option`, `product_option_value`, `product_variant`, `product_variant_option_value`, `product_image`, `category`, `product_category` (and `product_delivery_charge`, see [Settings – Delivery charges](../09-settings-delivery/README.md)) |
| Tenant integrity | Composite foreign keys on `(merchant_id, id)`, so no row can point at another merchant's row; RLS forced on all eight                                                                                                                                         |
| Lifecycle        | Product `status` (`draft` / `active` / `archived`); variants archived (`archived_at`); categories soft-deleted                                                                                                                                                |
| Sellable         | The assistant sees only `active` products, their options, live variants and live categories                                                                                                                                                                   |
| Money            | Integer minor units (`price`, a product's own delivery charges)                                                                                                                                                                                               |
| Options          | Up to 3 per product (Size, Sleeve), each with up to 30 ordered values; a variant is one value per option                                                                                                                                                      |
| Variants         | 1–100 live per product; a product without options has exactly one, unnamed, the default                                                                                                                                                                       |
| Concurrency      | `product.revision`, `version` on the wire; a save from an older read is `409 PRODUCT_STALE`                                                                                                                                                                   |
| SKU              | Required, unique per merchant among live variants, case-insensitive; generated when blank                                                                                                                                                                     |
| Categories       | A flat list; a product can be in several                                                                                                                                                                                                                      |
| Images           | Up to 8 per product, 10 MB per upload, re-encoded by `sharp`, stored in R2 through the S3 API; the cover is chosen, not the first in order                                                                                                                    |

## Data model

[`database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts).
Every table has `merchant_id` → `organization(id)` and a
`<table>_merchant_isolation` policy on `merchant_id = app_current_merchant()`.
All but the two link tables have a `text` UUID `id`, `created_at` and
`UNIQUE (merchant_id, id)` for the composite keys to target. RLS filters
reads but not the ids a row points at; the composite keys make a write of
another merchant's `product_id` or `category_id` fail in the database.

| Table                          | Key columns                                                                                                         | Constraints worth knowing                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`                      | `name`, `description`, `aliases text[]`, `status`, `custom_delivery`, `cover_image_id`, `revision`                  | `status` check; `revision >= 0`                                                                                                                                                                                                                                         |
| `product_option`               | `product_id`, `name`, `position`                                                                                    | FK to product `ON DELETE CASCADE`; `position` dense `0..n-1` (the order customers are asked in), not unique. The service keeps names unique within a product, under the product row lock                                                                                |
| `product_option_value`         | `option_id`, `value`, `position`                                                                                    | FK to option `ON DELETE CASCADE`; `UNIQUE (merchant_id, option_id, id)`, the target of the link table's key                                                                                                                                                             |
| `product_variant`              | `product_id`, `name` (null = default), `sku`, `price`, `stock`, `reserved`, `is_default`, `image_id`, `archived_at` | FK to product `ON DELETE CASCADE`; `price`, `stock >= 0`; `reserved >= 0` and `reserved <= stock`; `is_default = (name IS NULL)`; partial unique `(merchant_id, sku) WHERE archived_at IS NULL`; partial unique `(product_id) WHERE is_default AND archived_at IS NULL` |
| `product_variant_option_value` | PK `(merchant_id, variant_id, option_id)`, `option_value_id`                                                        | One value per option per variant; the value key carries `option_id`, so the value must be that option's. Both keys cascade                                                                                                                                              |
| `product_image`                | `product_id`, `storage_key`, `position`, `width`, `height`, `byte_size`                                             | FK to product `ON DELETE CASCADE`; `storage_key` unique; `position` dense `0..n-1`, gallery order only, not unique so a reorder needs no deferral                                                                                                                       |
| `category`                     | `name`, `deleted_at`                                                                                                | Partial unique `(merchant_id, lower(name)) WHERE deleted_at IS NULL`                                                                                                                                                                                                    |
| `product_category`             | PK `(merchant_id, product_id, category_id)`                                                                         | FK to product `ON DELETE CASCADE`; FK to category                                                                                                                                                                                                                       |

- `product_variant.image_id` and `product.cover_image_id` reference
  `product_image (merchant_id, id)` `ON DELETE SET NULL (<column>)`. drizzle-kit
  cannot express the column list, and a plain composite `SET NULL` would null
  `merchant_id` too, so these keys are in custom migrations `0006` and `0014`.
- `FORCE ROW LEVEL SECURITY` is a custom migration as well.
- The schema exports `VARIANT_SKU_LIVE_UIDX` and `CATEGORY_NAME_LIVE_UIDX`,
  whose unique violations the services map to coded errors.

## Rules

[`modules/categories/`](../../../apps/api/src/modules/categories/) and
[`modules/products/`](../../../apps/api/src/modules/products/) each have a
repository and a service. `ProductsModule` imports `CategoriesModule` for
`CategoriesRepository` (the category lock and liveness checks), never the
reverse. Every repository method takes an `Executor` and a `TenantScope` and
filters by `merchantId`; every service method runs in `withMerchant`.

### Categories

A category is a name in a flat list.

- **Delete** is soft. It takes
  `pg_advisory_xact_lock(hashtextextended('category:<merchantId>', 0))`
  (`CategoriesRepository.lockCategories`), the lock a product takes to link
  categories, so no link lands between the liveness check and the delete. It
  sets `deleted_at` and hard-deletes the category's `product_category` rows in
  the same transaction.
- **Names** are trimmed. A name used by another live category, ignoring case,
  is `CATEGORY_NAME_TAKEN`, mapped from the unique index so two racing
  requests cannot both take it. Deleting releases the name. A rename that
  loses a race to a delete finds no row and answers `CATEGORY_NOT_FOUND`.

### The product document

The edit page saves fields, options, values and variants as one document
(`PUT /products/:id`, `saveProductSchema`).
[`product-document-plan.ts`](../../../apps/api/src/modules/products/options/product-document-plan.ts)
plans the save without the database, and `ProductWriter` applies it in one
transaction under the product row lock. `POST /products` takes the same
document without a `version`.

- **What a save keeps.** An option, value or variant sent with its `id` is
  kept and may be renamed; one without an `id` is created. Options and values
  left out are deleted; variants left out are archived. An id that is not this
  product's is `PRODUCT_OPTION_NOT_FOUND` or `VARIANT_NOT_FOUND`.
- **Variants pick values by text.** `optionValues` names one value per option,
  in option order, so a variant can use a value created in the same save.
  `refineProductDocument`, run by the form and by the API, reports field codes
  under `VALIDATION_FAILED`: `OPTION_VALUES_MISMATCH` (not one value per
  option), `UNKNOWN_OPTION_VALUE`, `VARIANTS_NEED_OPTION` (several variants,
  no options) and `DUPLICATE` (a repeated option name, value, variant or SKU).
  Text compares trimmed and case-insensitively.
- **Default variant.** A product with no options has one variant, unnamed and
  `is_default`. Otherwise a variant's name is the seller's or its values joined
  (`M / Short`), rewritten on every save and kept on archived variants so
  order lines still read.
- **Delivery charge.** `customDelivery: false` (the default) uses the shop's
  charges ([Delivery charges](../09-settings-delivery/README.md)). `true` uses
  `deliveryCharges`, `[{ deliveryChargeId, charge }]`, stored in
  `product_delivery_charge`; an area left out costs the shop charge. Every
  save replaces them, and `customDelivery: false` drops them. An unknown area
  is `DELIVERY_CHARGE_NOT_FOUND`; one listed twice is `DUPLICATE` at
  `deliveryCharges.<i>.deliveryChargeId`. Removing an area in Settings
  removes every product's charge for it.
- **Version.** Every write to the product's fields, options or variants, and
  every order stock or reservation move, bumps `revision`, sent as an opaque `version`. A
  save with an old `version` is `409 PRODUCT_STALE`, so the second of two
  saves from one read is refused. Gallery changes do not bump it, since the
  edit page does not hold the gallery.

### Variants

- **SKU.** Trimmed and upper-cased on write
  ([`sku.ts`](../../../apps/api/src/modules/products/sku.ts)). A blank SKU
  becomes `SKU-` plus 8 Crockford base32 characters, inserted with
  `ON CONFLICT DO NOTHING` and retried up to 5 times. A typed SKU a live
  variant uses is `SKU_TAKEN`. Archiving releases the SKU.
- **Archive, never delete.** Order lines reference variants, and archiving
  stops the assistant calling a discontinued option "out of stock". Removing
  an option value means leaving out its variants, which archives them.
- **One variant alone.** `PATCH /products/:id/variants/:variantId` changes a
  live variant's SKU, price, stock or image outside the document. Option
  values change only through a save. It bumps the version.
- **Image.** `imageId` must be one of the product's images. A variant update
  naming another is `PRODUCT_IMAGE_NOT_FOUND`; a save treats it as `null`,
  since the photo may have been deleted after the page read. `null` falls back
  to the cover.
- **Stock** is set by the seller and moved by orders. `reserved` is the count
  drafted orders hold and the seller never writes it; `available` is stock
  less reserved. `stockStatus` (`in_stock` or `out_of_stock`), the list's
  stock level, the filters, the counts and what the assistant offers all use
  `available`. A save that sets stock below `reserved` is
  `409 VARIANT_STOCK_RESERVED` with `{ variantId, name, reserved }`, refused by
  `assertStockCoversReserved` under the product lock; the `reserved <= stock`
  check is the backstop.

### Products

- `status` moves freely between `draft`, `active` and `archived`.
  `PATCH /products/:id` changes only the fields sent; it takes no `version`
  but bumps it.
- `categoryIds` on create, save or update replaces the links, checked for
  liveness under the category lock (`CATEGORY_NOT_FOUND`).
- **Cover.** `cover_image_id` is the photo the assistant sends when no variant
  is picked, and for variants without their own. It is null exactly when the
  product has no photos. The first upload becomes the cover, and deleting the
  cover promotes the first remaining photo. A save with `coverImageId: null`,
  or naming a deleted photo, picks the first photo. Reordering never changes
  the cover.
- **Hard delete** cascades to options, variants, category links and image
  rows, then deletes the image objects after commit, best-effort. Once an
  order line references a variant, the database refuses and the API answers
  `409 PRODUCT_IN_USE`; the seller archives instead.

### Products list

`GET /products` and `GET /products/counts` (`ProductsService.list` and
`counts`).

- **One row per product**, summing its live variants: count, price range,
  total available (`available`, on hand less reserved), and how many are low
  or out. Expanding a row reads
  `GET /products/:id`, which the edit page then opens from cache. A product
  with one live variant carries it inline as `variant`.
- **Stock levels.** A variant is low at `LOW_STOCK_THRESHOLD` (5) or fewer
  available and out at 0 available. A product is out when no variant has any, low when any variant
  is low or out, and in stock otherwise.
- **Filters.** `all` and the three stock filters leave archived products out;
  `draft` and `archived` list that status. Each non-archived product counts
  under exactly one stock chip. `q` matches the name, a tag or a live SKU, and
  `categoryId` keeps one category. Counts ignore search and category.
- **Paging** by number (`page`, `limit` 10, 25, 50 or 100), newest first, with
  a total.

### Categories page

`/catalog/categories` reads `GET /categories` once and searches, sorts (name
or product count) and pages it in the browser, since a seller has tens of
categories.

- **Rename and add in the row.** Enter saves, Escape cancels, and
  `CATEGORY_NAME_TAKEN` shows under the open box.
- **Delete asks first**, naming the products it comes off, the other
  categories each keeps, and how many are left with none. The list is one
  `GET /products?categoryId=` page of 100, so archived products are counted
  in `productCount` but not listed.
- **Counts stay current:** every product write also refreshes the categories.

### Visibility

Drizzle has no soft-delete filter, so every read uses a named predicate:

| Helper            | Predicate             | File                                                                                        |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `liveVariant`     | `archived_at IS NULL` | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `sellableProduct` | `status = 'active'`   | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `liveCategory`    | `deleted_at IS NULL`  | [`category-visibility.ts`](../../../apps/api/src/modules/categories/category-visibility.ts) |

- `ProductsService.findSellableCatalog(merchantId)`, the assistant's read,
  returns active products with options, live variants, category ids and
  images, plus the live categories.
- Dashboard reads return a product of any status with its options, never
  archived variants or deleted categories.

## Product images

[`products/images/`](../../../apps/api/src/modules/products/images/). Photos
reach customers through Meta, so each has a stable public URL and keeps only
its pixels.

### Upload sequence

No `sharp` or storage call runs inside a transaction.
[`ProductImagesService.upload`](../../../apps/api/src/modules/products/images/product-images.service.ts):

1. **Pre-check** that the product exists (`PRODUCT_NOT_FOUND`) and has fewer
   than 8 images (`PRODUCT_IMAGE_LIMIT_REACHED`).
2. **Receive.** Multer reads one `file` into memory and aborts while
   streaming past 10 MB.
   [`ProductImageUploadInterceptor`](../../../apps/api/src/modules/products/images/product-image-upload.interceptor.ts)
   turns Multer's exceptions into coded ones.
3. **Normalize** with
   [`normalizeProductImage`](../../../apps/api/src/modules/products/images/normalize-product-image.ts).
   `sharp` detects the format; the client's MIME type is ignored. JPEG, PNG
   and WebP are accepted. Over 40 megapixels or undecodable is invalid. It
   applies EXIF orientation, flattens alpha onto white, drops all metadata
   (GPS, XMP, ICC), and fits the full image in 2048×2048 at JPEG q82 and the
   thumbnail in 400×400 at q75, never enlarging.
4. **Store** the full image, then the thumbnail. If either fails, what was
   written is deleted and the answer is `STORAGE_UNAVAILABLE`.
5. **Commit.** A short transaction locks the product, re-checks existence and
   the limit, and inserts at the next position. On failure both objects are
   deleted best-effort.

### Storage layout

| Object    | Key                             |
| --------- | ------------------------------- |
| Full      | `m/{merchantId}/{id}.jpg`       |
| Thumbnail | `m/{merchantId}/{id}-thumb.jpg` |

Only
[`productImageKeys`](../../../apps/api/src/modules/products/images/product-image-keys.ts)
builds keys, from the session's merchant id and a server-made UUID. Objects
are immutable (`Content-Type: image/jpeg`,
`Cache-Control: public, max-age=31536000, immutable`); a new photo is a new
key. Only `storage_key` is stored; the thumbnail key and both URLs
(`STORAGE_PUBLIC_BASE_URL` + key) are derived. The `m/{merchantId}/` prefix
tells the sweep whose object it is.

### Delete and reorder

- **Delete.** One transaction locks the product, deletes the row, rewrites
  positions to `0..n-1`, and promotes the first remaining photo if the cover
  went. Objects are deleted after commit; a failure is logged and left to the
  sweep. Another merchant's product answers like a missing image.
- **Reorder.** One transaction locks the product, checks that `imageIds` is a
  permutation of the current ids (`PRODUCT_IMAGE_ORDER_MISMATCH`), and
  rewrites positions. It does not change the cover.

### Orphan sweep

An object without a row appears only when a best-effort delete fails.
[`StorageSweepProcessor`](../../../apps/api/src/modules/products/images/storage-sweep.processor.ts)
runs
[`sweepOrphanedImages`](../../../apps/api/src/modules/products/images/sweep-orphaned-images.ts)
daily at 03:00 in the worker's time zone (UTC in the containers), through the
BullMQ scheduler `sweep-orphaned-images-daily` (`0 3 * * *`), upserted on
each worker boot. Only the worker registers the processor.

- It pages through `m/` and skips, never deletes, a key that does not parse.
- It looks up surviving ids per merchant inside `withMerchant`; under forced
  RLS a lookup without merchant context sees no rows and would call everything
  an orphan.
- It leaves objects younger than 24 hours, whose upload may not have
  committed.
- **Circuit breaker.** If orphans exceed 20% of the objects examined and
  number more than 10, it deletes nothing and logs an error.

## Routes

[`products.controller.ts`](../../../apps/api/src/modules/products/products.controller.ts),
behind the session and `TenantGuard`. Every product answer is `productSchema`:
the product with `options`, live `variants`, `categoryIds`, `images`,
`coverImageId`, `customDelivery`, `deliveryCharges` and `version`. A non-UUID
`:id` is `400 VALIDATION_FAILED`.

| Method | Path                                       | Body                  | Success               | Errors                                                                                                                                                                                                                 |
| ------ | ------------------------------------------ | --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/products`                         | `createProductSchema` | 201, the product      | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`, 409 `SKU_TAKEN`                                                                                                                       |
| GET    | `/api/v1/products`                         | query, below          | 200, a page           | 400 `VALIDATION_FAILED`                                                                                                                                                                                                |
| GET    | `/api/v1/products/counts`                  | none                  | 200, count per filter | none                                                                                                                                                                                                                   |
| GET    | `/api/v1/products/:id`                     | none                  | 200, the product      | 404 `PRODUCT_NOT_FOUND`                                                                                                                                                                                                |
| PUT    | `/api/v1/products/:id`                     | `saveProductSchema`   | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `PRODUCT_OPTION_NOT_FOUND` / `VARIANT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`, 409 `PRODUCT_STALE` / `SKU_TAKEN` / `VARIANT_STOCK_RESERVED` |
| PATCH  | `/api/v1/products/:id`                     | `updateProductSchema` | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`                                                                                                                  |
| PATCH  | `/api/v1/products/:id/variants/:variantId` | `updateVariantSchema` | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `VARIANT_NOT_FOUND` / `PRODUCT_IMAGE_NOT_FOUND`, 409 `SKU_TAKEN` / `VARIANT_STOCK_RESERVED`                                                                         |
| DELETE | `/api/v1/products/:id`                     | none                  | 204                   | 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_IN_USE`                                                                                                                                                                          |

The list takes `filter`, `q`, `categoryId`, `page` and `limit`, ignores other
parameters, and answers `400 VALIDATION_FAILED` on a bad value. `limit` is
what the Customers and Orders lists call `pageSize`.

Images, in
[`product-images.controller.ts`](../../../apps/api/src/modules/products/images/product-images.controller.ts):

| Method | Path                                          | Body                     | Success                   | Errors                                                                                                                                                                                                        |
| ------ | --------------------------------------------- | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/products/:productId/images`          | multipart, field `file`  | 201, the image            | 400 `VALIDATION_FAILED` / `PRODUCT_IMAGE_INVALID`, 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_IMAGE_LIMIT_REACHED`, 413 `PRODUCT_IMAGE_TOO_LARGE`, 415 `PRODUCT_IMAGE_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| DELETE | `/api/v1/products/:productId/images/:imageId` | none                     | 204                       | 400 `VALIDATION_FAILED`, 404 `PRODUCT_IMAGE_NOT_FOUND`                                                                                                                                                        |
| PUT    | `/api/v1/products/:productId/images/order`    | `{ imageIds: string[] }` | 200, the reordered images | 400 `VALIDATION_FAILED` / `PRODUCT_IMAGE_ORDER_MISMATCH`, 404 `PRODUCT_NOT_FOUND`                                                                                                                             |

Upload has its own throttle of 30 a minute per client. An image is
`{ id, url, thumbnailUrl, position, width, height }`, embedded in products by
position, so there is no list route. A variant's image is set through its
`imageId`.

Categories, in
[`categories.controller.ts`](../../../apps/api/src/modules/categories/categories.controller.ts),
return `{ id, name, productCount }` (`categoryWithCountSchema`).
`productCount` counts every linked product of any status, which is what a
delete takes the category off, so it can exceed what the products list shows
by default. `findSellableCatalog` keeps the plain `{ id, name }`.

| Method | Path                     | Body               | Success            | Errors                                                                       |
| ------ | ------------------------ | ------------------ | ------------------ | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/categories`     | none               | 200, live, by name | none                                                                         |
| POST   | `/api/v1/categories`     | `{ name: string }` | 201, the category  | 400 `VALIDATION_FAILED`, 409 `CATEGORY_NAME_TAKEN`                           |
| PATCH  | `/api/v1/categories/:id` | `{ name: string }` | 200, the category  | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND`, 409 `CATEGORY_NAME_TAKEN` |
| DELETE | `/api/v1/categories/:id` | none               | 204                | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND`                            |

## Errors

Thrown from
[`product-errors.ts`](../../../apps/api/src/modules/products/product-errors.ts),
[`category-errors.ts`](../../../apps/api/src/modules/categories/category-errors.ts),
[`delivery-errors.ts`](../../../apps/api/src/modules/settings/delivery-errors.ts),
the upload interceptor and
[`s3-object-storage.ts`](../../../apps/api/src/modules/storage/s3-object-storage.ts).

| Code                             | Status | Params                          | When                                                            |
| -------------------------------- | ------ | ------------------------------- | --------------------------------------------------------------- |
| `PRODUCT_NOT_FOUND`              | 404    | `{ id }`                        | No such product for this merchant                               |
| `VARIANT_NOT_FOUND`              | 404    | `{ id }`                        | No such live variant on the product                             |
| `CATEGORY_NOT_FOUND`             | 404    | `{ id }` or `{}`                | Missing or deleted category (as target or link)                 |
| `CATEGORY_NAME_TAKEN`            | 409    | `{ name }`                      | Name used by another live category, ignoring case               |
| `PRODUCT_OPTION_NOT_FOUND`       | 404    | `{ id }`                        | A save names an option or value id that is not this product's   |
| `PRODUCT_STALE`                  | 409    | `{ id }`                        | A save's `version` is not the product's current one             |
| `PRODUCT_IN_USE`                 | 409    | `{ id }`                        | Deleting a product an order line references                     |
| `SKU_TAKEN`                      | 409    | `{ sku }`                       | Typed SKU already used by a live variant                        |
| `VARIANT_STOCK_RESERVED`         | 409    | `{ variantId, name, reserved }` | A save sets a variant's stock below what drafted orders reserve |
| `DELIVERY_CHARGE_NOT_FOUND`      | 404    | `{ id }`                        | A product's own charge names an area the shop does not have     |
| `PRODUCT_IMAGE_TOO_LARGE`        | 413    | `{ maxBytes }`                  | Upload over 10 MB                                               |
| `PRODUCT_IMAGE_UNSUPPORTED_TYPE` | 415    | none                            | Not JPEG, PNG or WebP                                           |
| `PRODUCT_IMAGE_INVALID`          | 400    | none                            | Undecodable, over 40 MP, or not exactly one file in `file`      |
| `PRODUCT_IMAGE_LIMIT_REACHED`    | 409    | `{ max }`                       | Product already has 8 images                                    |
| `PRODUCT_IMAGE_ORDER_MISMATCH`   | 400    | none                            | Reorder ids are not a permutation of the current images         |
| `PRODUCT_IMAGE_NOT_FOUND`        | 404    | `{ id }`                        | No such image on this product, or a variant's foreign image     |
| `STORAGE_UNAVAILABLE`            | 503    | none                            | R2 rejected or failed a request                                 |

The document's own rules are field codes under `400 VALIDATION_FAILED`
([The product document](#the-product-document)).

## Shared contract

[`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts)
holds the resources (`productSchema`, `variantSchema` with `reserved`,
`available`, `stockStatus` and `optionValueIds`, `categoryWithCountSchema`,
`productImageSchema`, the list's `productListItemSchema` and `productCountsSchema`, and others), the inputs
(`createProductSchema` and `saveProductSchema`, both running
`refineProductDocument` and defaulting status to `draft`; `updateProductSchema`,
`updateVariantSchema`, `listProductsQuerySchema`, the category and reorder
inputs, `productCsvRowSchema`), the limits (`PRODUCT_IMAGE_MAX_BYTES`,
`PRODUCT_IMAGE_MAX_COUNT`, `PRODUCT_OPTION_MAX_COUNT`,
`PRODUCT_OPTION_VALUE_MAX_COUNT`, `PRODUCT_VARIANT_MAX_COUNT`,
`LOW_STOCK_THRESHOLD`), and `productStatusSchema` and `stockStatusSchema`,
each with entries in `apps/web/src/i18n/status-keys.ts`.

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts).
All are required except `STORAGE_REGION`.

| Variable                    | Notes                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `STORAGE_ENDPOINT`          | S3 API endpoint of the bucket (Cloudflare R2)                               |
| `STORAGE_REGION`            | Defaults to `auto`                                                          |
| `STORAGE_BUCKET`            | Development has its own bucket; never point a local `.env` at production    |
| `STORAGE_ACCESS_KEY_ID`     | A token scoped to that one bucket                                           |
| `STORAGE_SECRET_ACCESS_KEY` | Redacted from logs (`*.secretAccessKey` in the pino config)                 |
| `STORAGE_PUBLIC_BASE_URL`   | Public base for image URLs: the custom domain in production, never `r2.dev` |

[`StorageModule`](../../../apps/api/src/modules/storage/storage.module.ts) is
the only importer of `@aws-sdk/*`, behind the `ObjectStorage` interface that
tests replace with an in-memory fake. The client computes checksums only when
required (R2 needs this) and bounds requests at 5 s to connect and 30 s
overall.

## Security notes

- **Tenant isolation in three layers:** `TenantGuard`, repository filters and
  forced RLS. Composite keys also stop a row pointing at another merchant's
  row, which RLS alone misses.
- **Photos carry no private data.** Every upload is re-encoded without EXIF,
  XMP or ICC, and `sharp` decides the format.
- **Storage keys are server-made**, so a request cannot reach outside its
  merchant's prefix.
- **The sweep fails safe** on unparseable keys, recent objects and mass
  deletions.

## Tests

| Spec                                                                                                                                                   | Covers                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [`database/__tests__/catalog-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/catalog-schema.spec.ts)                                 | Constraints: composite keys, checks, partial unique indexes                                                   |
| [`database/__tests__/catalog-rls.spec.ts`](../../../apps/api/src/modules/database/__tests__/catalog-rls.spec.ts)                                       | Two-merchant isolation under RLS                                                                              |
| [`categories/__tests__/categories.service.spec.ts`](../../../apps/api/src/modules/categories/__tests__/categories.service.spec.ts)                     | Create, rename, delete, name clashes, product counts, two-merchant isolation                                  |
| [`categories/__tests__/categories.e2e.spec.ts`](../../../apps/api/src/modules/categories/__tests__/categories.e2e.spec.ts)                             | Category routes over HTTP: status codes, error envelopes, unlinking on delete, two-merchant isolation         |
| [`products/__tests__/products.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/products.service.spec.ts)                             | Product create, update, category links                                                                        |
| [`products/__tests__/product-save.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-save.service.spec.ts)                     | The document save: options, values, variants kept, created and archived; `PRODUCT_STALE`                      |
| [`products/__tests__/product-document-schema.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-document-schema.spec.ts)               | `refineProductDocument`'s field codes                                                                         |
| [`products/options/__tests__/`](../../../apps/api/src/modules/products/options/__tests__/)                                                             | The document plan and the options repository                                                                  |
| [`products/__tests__/product-variant-update.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-variant-update.service.spec.ts) | One variant's SKU, price, stock and image                                                                     |
| [`products/__tests__/product-delete.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-delete.service.spec.ts)                 | Hard delete, and `PRODUCT_IN_USE` while an order line points at a variant                                     |
| [`products/__tests__/product-list.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-list.service.spec.ts)                     | The list, its filters, search and counts                                                                      |
| [`products/__tests__/product-gallery.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-gallery.service.spec.ts)               | Images embedded in products; object cleanup on product delete                                                 |
| [`products/__tests__/products.e2e.spec.ts`](../../../apps/api/src/modules/products/__tests__/products.e2e.spec.ts)                                     | Product routes over HTTP                                                                                      |
| [`products/__tests__/sellable-catalog.spec.ts`](../../../apps/api/src/modules/products/__tests__/sellable-catalog.spec.ts)                             | `findSellableCatalog` visibility                                                                              |
| [`products/__tests__/sku.spec.ts`](../../../apps/api/src/modules/products/__tests__/sku.spec.ts)                                                       | SKU normalization and generation                                                                              |
| [`products/images/__tests__/`](../../../apps/api/src/modules/products/images/__tests__/)                                                               | Normalization, keys, interceptor, repository, service, cover, sweep, and a multipart e2e through the Nest app |
| [`db/seed/__tests__/`](../../../apps/api/db/seed/__tests__/)                                                                                           | The dev seed: catalog passes the product schema, re-runs, filler numbering, reset, two shops                  |
| [`storage/__tests__/s3-object-storage.spec.ts`](../../../apps/api/src/modules/storage/__tests__/s3-object-storage.spec.ts)                             | The S3 adapter and its error mapping                                                                          |

Database-backed specs are skipped unless `TEST_DATABASE_ADMIN_URL` is set
(see `AGENTS.md`). No test contacts R2. Run them with
`pnpm --filter api test -- catalog products categories`.

## Dev seed

`pnpm --filter api db:seed-products [--org <slug>] [--count <n>] [--reset]`
fills a shop's catalog for development:

- **About 20 hand-written products** from a Dhaka clothing shop in five
  categories: one to three options, sold-out variants, Banglish aliases,
  drafts, an archived product, and custom delivery charges (the shop's
  charges plus a surcharge).
- **`--count <n>`** adds generated products without photos, numbered after
  the last run's (`… #21`), from a fixed-seed generator.
- **`--reset`** deletes the shop's products first, keeping any an order
  points at.
- **`--org`** is the shop's slug (its organization id); leave it out when the
  database has one shop. An unknown slug prints the shops.

It writes through `ProductsService` and `CategoriesService` as `app_runtime`,
so rows pass validation and RLS, and re-runs reuse or skip what exists by
name. It refuses unless `NODE_ENV=development` and `DATABASE_URL` is local,
and builds with SWC into `dist/seed`, leaving the dev server's `dist` alone.

## Dashboard

- **`/catalog`**: the [products list](#products-list).
- **`/catalog/products/new`** and **`/catalog/products/$productId`**: details,
  the option editor and variant table, the variant image picker, status,
  categories, aliases (shown as Tags), the Delivery charge card, and the photo
  dialogs (Add photos with per-file progress, All photos with delete and the
  default choice, a full-screen viewer). The default photo saves with the
  page; uploads and deletes happen at once. The variant table shows "N reserved
  · M available" under a variant's stock, and `VARIANT_STOCK_RESERVED` names
  the variant. A `PRODUCT_STALE` answer means another save or an order changed
  the product since the page read it.
- **Messenger link card** on the product page: the product's
  `https://m.me/<pageId>?ref=p_<productId>` link with Copy, a QR code drawn in
  the browser and Download QR (PNG). Without a connected Page it says to
  connect one, and a product that is not Published gets a note, because the
  assistant ignores a link to it
  ([phase 11.3](../11-ai-implementation/phase-3-entry-points/README.md#dashboard)).
- **Facebook posts card** on the product page: posts linked to the product,
  the assistant's suggestions with Accept and Dismiss, a field to paste a
  post's link, and **Choose from your Page** for the Page's 25 newest posts
  ([phase 11.5](../11-ai-implementation/phase-5-shared-posts/README.md#dashboard)).
- **`/catalog/categories`**: the [Categories page](#categories-page).

## Not yet built

- **Dashboard extras:** reordering photos; the Categories page's insights
  panel (what customers ask for, missing categories, needs attention); and
  fields the API does not hold yet (assistant notes, a per-seller low-stock
  threshold, sales figures). The product-level "Free delivery" option was
  left out on purpose; the shop's threshold is the only free delivery.
- **CSV import.** Only `productCsvRowSchema` exists. CSV carries no images or
  categories.
- **Categories in typed matching.** Matching
  ([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#matching))
  uses names, aliases and option values only. Categories drive browsing since
  [phase 11.3](../11-ai-implementation/phase-3-entry-points/README.md#browsing).
- **Bulk object removal on account deletion**, which the `m/{merchantId}/`
  prefix makes one prefix delete.

## Key files

Under `apps/api/src/modules/` unless noted:

- [`database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts): the eight tables
- [`categories/categories.service.ts`](../../../apps/api/src/modules/categories/categories.service.ts) and [`categories.repository.ts`](../../../apps/api/src/modules/categories/categories.repository.ts): category rules, lock, soft delete
- [`products/products.service.ts`](../../../apps/api/src/modules/products/products.service.ts) and [`products.repository.ts`](../../../apps/api/src/modules/products/products.repository.ts): product and variant rules, `findSellableCatalog`, SKU retries
- [`products/options/product-document-plan.ts`](../../../apps/api/src/modules/products/options/product-document-plan.ts) and [`product-writer.ts`](../../../apps/api/src/modules/products/options/product-writer.ts): planning and applying a document save
- [`products/images/`](../../../apps/api/src/modules/products/images/): upload, normalize, sweep
- [`storage/storage.module.ts`](../../../apps/api/src/modules/storage/storage.module.ts): the R2 client
- [`apps/api/db/seed/product-seeder.ts`](../../../apps/api/db/seed/product-seeder.ts) and [`seed-catalog.ts`](../../../apps/api/db/seed/seed-catalog.ts): the dev seed
- [`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts): the shared contract
