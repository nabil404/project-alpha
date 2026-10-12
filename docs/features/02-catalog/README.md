# 02 · Product catalog

How a seller's products, options, variants, categories and photos are stored,
kept consistent, and read back by the dashboard and the AI. Scope comes from
the MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model). This page
describes what is actually built.

**Status (Oct 2026):** built end to end, except CSV import (see
[Not yet built](#not-yet-built)). The build has these parts:

- Eight tables with composite tenant keys and forced row-level security.
- `CategoriesService` and `ProductsService`, with every rule below and the
  AI's `findSellableCatalog` read.
- The product routes, which save options and variants as one versioned
  document.
- Image upload, delete, reorder and cover, stored on Cloudflare R2.
- A daily orphan sweep in the worker.
- The dashboard's products list, add and edit page, and Categories page.

Orders move stock. See [Orders](../07-orders/README.md#rules).

## At a glance

| Concern          | Decision                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables           | `product`, `product_option`, `product_option_value`, `product_variant`, `product_variant_option_value`, `product_image`, `category`, `product_category` (and `product_delivery_charge`, see [Settings – Delivery charges](../09-settings-delivery/README.md)) |
| Tenant integrity | Composite foreign keys on `(merchant_id, id)` so no row can point at another merchant's row; RLS forced on all eight                                                                                                                                          |
| Lifecycle        | Product `status` (`draft` / `active` / `archived`); variants archived (`archived_at`); categories soft-deleted                                                                                                                                                |
| Sellable         | The AI sees only `active` products, their options, live variants and live categories                                                                                                                                                                          |
| Money            | Integer minor units (`price`, a product's own delivery charges), never floats                                                                                                                                                                                 |
| Options          | Up to 3 per product (Size, Sleeve), each with up to 30 ordered values; a variant is one value per option                                                                                                                                                      |
| Variants         | 1–100 live per product; a product without options has exactly one, unnamed, the default                                                                                                                                                                       |
| Concurrency      | `product.revision`, `version` on the wire; a save from an older read is `409 PRODUCT_STALE`                                                                                                                                                                   |
| SKU              | Required, unique per merchant among live variants, case-insensitive; generated when left blank                                                                                                                                                                |
| Categories       | A flat list, no nesting; a product can sit in several                                                                                                                                                                                                         |
| Images           | Up to 8 per product, 10 MB per upload, re-encoded by `sharp`, stored in R2 through the S3 API; the cover is chosen, not the first in order                                                                                                                    |

## Data model

Defined in
[`database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts).
Every table has a `merchant_id` referencing `organization(id)` and a
`<table>_merchant_isolation` policy on `merchant_id = app_current_merchant()`.
Every table except the two link tables has a `text` UUID `id`, `created_at`,
and `UNIQUE (merchant_id, id)`, which the composite foreign keys point at.
`product_category` has `created_at` too, and `product_variant_option_value`
has no timestamps. RLS filters reads, but it does not check the ids a row points
at. The composite keys do that, so a bug that writes another merchant's
`product_id` or `category_id` fails in the database.

| Table                          | Key columns                                                                                             | Constraints worth knowing                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product`                      | `name`, `description`, `aliases text[]`, `status`, `custom_delivery`, `cover_image_id`, `revision`      | `status` check; `revision >= 0`                                                                                                                                                                                                |
| `product_option`               | `product_id`, `name`, `position`                                                                        | FK to product `ON DELETE CASCADE`; `position` dense `0..n-1` (the order customers are asked in), not unique. Name uniqueness within a product is the service's, under the product row lock                                     |
| `product_option_value`         | `option_id`, `value`, `position`                                                                        | FK to option `ON DELETE CASCADE`; `UNIQUE (merchant_id, option_id, id)`, the target of the link table's key                                                                                                                    |
| `product_variant`              | `product_id`, `name` (null = default), `sku`, `price`, `stock`, `is_default`, `image_id`, `archived_at` | FK to product `ON DELETE CASCADE`; `price`, `stock >= 0`; `is_default = (name IS NULL)`; partial unique `(merchant_id, sku) WHERE archived_at IS NULL`; partial unique `(product_id) WHERE is_default AND archived_at IS NULL` |
| `product_variant_option_value` | PK `(merchant_id, variant_id, option_id)`, `option_value_id`                                            | One value per option per variant; the value key carries `option_id`, so the value must be that option's. Both keys cascade                                                                                                     |
| `product_image`                | `product_id`, `storage_key`, `position`, `width`, `height`, `byte_size`                                 | FK to product `ON DELETE CASCADE`; `storage_key` unique; `position` dense `0..n-1`, gallery order only, deliberately not unique so a reorder needs no deferral                                                                 |
| `category`                     | `name`, `deleted_at`                                                                                    | Partial unique `(merchant_id, lower(name)) WHERE deleted_at IS NULL`                                                                                                                                                           |
| `product_category`             | PK `(merchant_id, product_id, category_id)`                                                             | FK to product `ON DELETE CASCADE`; FK to category                                                                                                                                                                              |

`product_variant.image_id` and `product.cover_image_id` reference
`product_image (merchant_id, id)` `ON DELETE SET NULL (<column>)`. drizzle-kit
can't model the column list, and a plain composite `SET NULL` would also null
`merchant_id` and fail its `NOT NULL`. So those keys live in custom migrations
(`0006`, `0014`), not in `catalog.ts`.

drizzle-kit generates the tables, `ENABLE ROW LEVEL SECURITY` and the policies.
`FORCE ROW LEVEL SECURITY` is a custom migration too.

The schema exports the index names `VARIANT_SKU_LIVE_UIDX` and
`CATEGORY_NAME_LIVE_UIDX`, because the services map unique violations on them
to coded errors.

## Rules

Two Nest modules hold the rules,
[`modules/categories/`](../../../apps/api/src/modules/categories/) and
[`modules/products/`](../../../apps/api/src/modules/products/). Each has a
repository and a service. The dependency runs one way: `ProductsModule` imports
`CategoriesModule` for `CategoriesRepository` (the category lock and liveness
checks). Categories never import from products. Every repository method takes
an `Executor` and a `TenantScope` and filters by `merchantId`. Every service
method runs inside `withMerchant`.

### Categories

A category has a name and nothing else. Categories form a flat list with no
nesting.

**Delete** is a soft delete. It takes
`pg_advisory_xact_lock(hashtextextended('category:<merchantId>', 0))`
(`CategoriesRepository.lockCategories`), the same lock a product takes when it
links categories, so a product can't be linked to a category between the
liveness check and the delete. It sets `deleted_at` and hard-deletes the
category's `product_category` rows in the same transaction, so no junction join
can surface a deleted category.

**Names** are trimmed. A name that matches another live category of the same
merchant, ignoring case, answers `CATEGORY_NAME_TAKEN`. The service maps that
error from the unique index instead of checking first, so two racing requests
can't both take the name. Deleting a category releases its name. A rename takes
no lock. If it loses a race to a delete, it finds no live row and answers
`CATEGORY_NOT_FOUND`.

### The product document

The edit page saves a product's fields, options, values and variants as one
document (`PUT /products/:id`, `saveProductSchema`). The save is planned without
the database by
[`product-document-plan.ts`](../../../apps/api/src/modules/products/options/product-document-plan.ts)
and applied by `ProductWriter` in one transaction under the product row lock.
Creation (`POST /products`) takes the same document without a `version`.

- **What a save keeps.** An option, value or variant sent with its `id` is
  kept, and may be renamed. One sent without an `id` is created. Options and
  values left out are deleted. Variants left out are **archived**, never
  deleted. An id that isn't this product's answers `PRODUCT_OPTION_NOT_FOUND`
  or `VARIANT_NOT_FOUND`.
- **Variants pick values by text.** `optionValues` names one value per option,
  in the options' order, so a variant can use a value created in the same save.
  The shared refinements (`refineProductDocument`, run by the form and again by
  the API) report field codes under `VALIDATION_FAILED`:
  `OPTION_VALUES_MISMATCH` (not one value per option), `UNKNOWN_OPTION_VALUE`,
  `VARIANTS_NEED_OPTION` (several variants and no options) and `DUPLICATE` (an
  option name, a value, a variant's values or name, or a SKU repeated). Text
  compares trimmed and case-insensitively.
- **Default variant.** A product with no options has exactly one variant,
  unnamed and `is_default`. Otherwise a variant's name is the seller's, or else
  its values joined (`M / Short`), written on every save and kept on archived
  variants so order lines still read.
- **Delivery charge.** `customDelivery: false` (the default) prices delivery
  at the shop's charges ([Settings – Delivery charges](../09-settings-delivery/README.md)).
  `true` uses `deliveryCharges`, `[{ deliveryChargeId, charge }]`: the
  product's own charge per shop area, everywhere else included, stored in
  `product_delivery_charge`. An area it leaves out costs the shop charge.
  Every save replaces them, and saving with `customDelivery: false` drops
  them. An id that isn't one of the shop's areas answers
  `DELIVERY_CHARGE_NOT_FOUND`. An id listed twice answers `DUPLICATE` at
  `deliveryCharges.<i>.deliveryChargeId`.
  Removing an area in Settings removes every product's charge for it.
- **Version.** Every write to the product's fields, options or variants bumps
  `revision`, sent as an opaque `version`. A save whose `version` isn't the
  current one answers `409 PRODUCT_STALE`. Of two saves from one read, the
  second is refused instead of overwriting the first. Order stock moves bump
  `revision` too. Gallery changes don't, because the edit page doesn't hold the
  gallery.

### Variants

- **SKU.** The API trims and upper-cases a SKU on write
  ([`sku.ts`](../../../apps/api/src/modules/products/sku.ts)). For a blank
  SKU, it generates `SKU-` plus 8 Crockford base32 characters (no I, L, O or
  U), inserts with `ON CONFLICT DO NOTHING`, and retries up to 5 times. A typed
  SKU that a live variant already uses answers `SKU_TAKEN`.
  Archiving a variant releases its SKU.
- **Archive, never delete.** Order lines reference variants, so a variant is
  archived. That also stops the AI from calling a discontinued option "out of
  stock". Removing an option value means leaving out the variants that used
  it, which archives them.
- **One variant on its own.** `PATCH /products/:id/variants/:variantId`
  changes a live variant's SKU, price, stock or image outside the document (a
  quick stock change). Its option values change only through a save. It bumps
  the version, so an edit page still holding the old one can't overwrite it.
- **Image.** `imageId` must be one of the same product's images. The
  composite key already keeps it inside the merchant. A variant update that
  names another image answers `PRODUCT_IMAGE_NOT_FOUND`. A save treats such an
  id as `null`, because the page may name a photo deleted since it read.
  `null` falls back to the product's cover.
- **Stock.** The seller sets it, and orders move it. The API computes the
  derived `stockStatus` (`in_stock` or `out_of_stock`) on read.

### Products

- `status` moves freely between `draft`, `active` and `archived`.
  `PATCH /products/:id` changes only the fields sent (for example, from the
  status dropdown). It takes no `version`, but it bumps the version.
- `categoryIds` on create, save or update **replaces** the product's links. It
  is checked for liveness under the category lock, so a category can't be
  deleted between the check and the link (`CATEGORY_NOT_FOUND`).
- **Cover.** `cover_image_id` is the photo the assistant sends when no variant
  is picked, and for variants without their own. It is null exactly when the
  product has no photos. The first upload becomes the cover. Deleting the
  cover promotes the first remaining photo. A save with `coverImageId: null`,
  or with a photo deleted since the page read, picks the first photo.
  Reordering the gallery never changes the cover.
- **Hard delete** cascades to options, variants, category links and image rows.
  The image objects are deleted from storage after commit, best-effort. Once an
  order line references one of its variants, the database refuses the delete
  and the API answers `409 PRODUCT_IN_USE`. The seller archives the product
  instead.

### Products list

The dashboard's Products page reads `GET /products` and `GET /products/counts`
(`ProductsService.list` / `counts`).

- **One row per product.** The row sums up its live variants: count, price
  range, total stock, and how many variants are low or out. The variants
  themselves are not in the list. Expanding a row reads `GET /products/:id`,
  the edit page's read, so the edit page then opens from cache. A product with
  a single live variant carries it inline as `variant`, so its row needs no
  second read.
- **Stock levels.** A variant is low at `LOW_STOCK_THRESHOLD` (5) or fewer, and
  out at 0. A product is out when no variant has stock, low when any variant is
  low or out, and in stock otherwise. The threshold is a shared constant until
  sellers can set it.
- **Filters.** `all` and the three stock filters leave archived products out.
  `draft` and `archived` list products with that status. Every non-archived
  product counts under exactly one stock chip. `q` matches the name, a tag or a
  live SKU. `categoryId` keeps products in that category. Counts ignore search
  and category.
- **Paging.** The list pages by number (`page`, and a `limit` of 10, 25, 50 or
  100), newest first, with a total for "Showing 1–10 of 64". A seller's catalog
  is small enough that offset paging stays cheap, and the page shows numbered
  pages.

### Categories page

The dashboard's Categories page, at `/catalog/categories`, reads
`GET /categories` once. It searches, sorts (by name or by product count) and
pages that list in the browser, because a seller has tens of categories, not
thousands.

- **Rename and add in the row.** Enter saves, Escape cancels. A taken name
  (`CATEGORY_NAME_TAKEN`) shows under the box, which stays open.
- **Delete asks first**, naming the products the category comes off, with the
  other categories each keeps, and warning how many will be left with none.
  The list is one `GET /products?categoryId=` page of 100, so archived products
  are counted in `productCount` but not listed.
- **Counts stay current.** Every product write also refreshes the categories,
  since it can move a product in or out of one.

### Visibility

Drizzle has no automatic soft-delete filter, so every read uses a named
predicate:

| Helper            | Predicate             | File                                                                                        |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `liveVariant`     | `archived_at IS NULL` | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `sellableProduct` | `status = 'active'`   | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `liveCategory`    | `deleted_at IS NULL`  | [`category-visibility.ts`](../../../apps/api/src/modules/categories/category-visibility.ts) |

- **`ProductsService.findSellableCatalog(merchantId)`**, the AI's read, returns
  active products with their options, live variants, category ids and images,
  plus the merchant's live categories.
- **Dashboard reads** (`get`, and the result of every write) return a product
  of any status, with its options, but never archived variants or deleted
  categories.

## Product images

Handled by [`products/images/`](../../../apps/api/src/modules/products/images/).
Photos go to customers through Meta, so each one has a stable public URL, and
nothing of the upload survives except the pixels.

### Upload sequence

No `sharp` or storage call ever runs inside a database transaction (backend
invariant #1). [`ProductImagesService.upload`](../../../apps/api/src/modules/products/images/product-images.service.ts):

1. **Pre-check.** The product exists for this merchant (`PRODUCT_NOT_FOUND`)
   and has fewer than 8 images (`PRODUCT_IMAGE_LIMIT_REACHED`).
2. **Receive.** Multer reads one file from the `file` field into memory. It
   rejects the upload while streaming once it passes 10 MB, so an oversize
   upload is never fully buffered.
   [`ProductImageUploadInterceptor`](../../../apps/api/src/modules/products/images/product-image-upload.interceptor.ts)
   translates Multer's bare exceptions to coded ones.
3. **Normalize** with [`normalizeProductImage`](../../../apps/api/src/modules/products/images/normalize-product-image.ts).
   The format comes from `sharp`'s detection, never the client's MIME type.
   JPEG, PNG and WebP are accepted. Any other format, such as HEIC or GIF, is
   unsupported. An image over 40 megapixels, or one that doesn't decode, is
   invalid. The function applies EXIF orientation, flattens alpha onto white,
   and drops all metadata (GPS, XMP and ICC). The full image fits inside 2048×2048 at JPEG q82, the thumbnail inside
   400×400 at q75, and neither is enlarged.
4. **Store** the full image, then the thumbnail. If either put fails, whatever
   was written is deleted and the request answers `STORAGE_UNAVAILABLE`.
5. **Commit.** A short transaction locks the product row, re-checks existence
   and the limit, and inserts at the next position. If that fails, both objects
   are deleted best-effort and the error is rethrown.

### Storage layout

| Object    | Key                             |
| --------- | ------------------------------- |
| Full      | `m/{merchantId}/{id}.jpg`       |
| Thumbnail | `m/{merchantId}/{id}-thumb.jpg` |

Keys are built only by
[`productImageKeys`](../../../apps/api/src/modules/products/images/product-image-keys.ts),
from the session's merchant id and a server-made UUID. No request field ever
contributes to one. Objects are immutable: every put carries
`Content-Type: image/jpeg` and `Cache-Control: public, max-age=31536000, immutable`,
and a new photo is a new key. Only `storage_key` (the full image's) is stored.
The thumbnail key and both public URLs are derived, the URLs as
`STORAGE_PUBLIC_BASE_URL` + key. The `m/{merchantId}/` prefix lets the sweep
recover whose object it's looking at.

### Delete and reorder

- **Delete.** One transaction locks the product, deletes the row, and rewrites
  the remaining positions to `0..n-1`. If the deleted photo was the cover, the
  same transaction makes the first remaining photo the cover. The objects are
  deleted after commit. A failure is logged and left to the sweep. Another merchant's product answers
  exactly like a missing image.
- **Reorder.** One transaction locks the product and checks that `imageIds` is
  a permutation of the current ids (`PRODUCT_IMAGE_ORDER_MISMATCH` otherwise).
  It then rewrites positions. The order applies to the gallery only. The cover
  is set separately (see [Products](#products)).

### Orphan sweep

An object with no row appears only when a best-effort delete fails.
[`StorageSweepProcessor`](../../../apps/api/src/modules/products/images/storage-sweep.processor.ts)
runs [`sweepOrphanedImages`](../../../apps/api/src/modules/products/images/sweep-orphaned-images.ts)
daily at 03:00, via the BullMQ job scheduler `sweep-orphaned-images-daily`
(cron `0 3 * * *`). The pattern sets no time zone, so it runs in the worker's,
which is UTC in the containers.
The scheduler is upserted on every worker boot, so there is only ever one. The
processor is registered only in the worker, never in the API process.

- It pages through `m/`. **A key that doesn't parse is skipped, never
  deleted.**
- It looks up surviving ids per merchant **inside `withMerchant`**. Under
  forced RLS, a lookup without merchant context sees no rows and would treat
  every object as an orphan.
- Objects younger than 24 hours are left alone, because their upload may not
  have committed yet.
- **Circuit breaker.** If orphans exceed 20% of the objects examined _and_
  number more than 10, nothing is deleted and an error is logged.

## Routes

The product routes are in
[`products.controller.ts`](../../../apps/api/src/modules/products/products.controller.ts),
behind the session and `TenantGuard`, so the merchant always comes from the
session. Every product answer is `productSchema`: the product with `options`,
live `variants`, `categoryIds`, `images`, `coverImageId`, `customDelivery`,
`deliveryCharges` and `version`.

| Method | Path                                       | Body                  | Success               | Errors                                                                                                                                                                                      |
| ------ | ------------------------------------------ | --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/products`                         | `createProductSchema` | 201, the product      | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`, 409 `SKU_TAKEN`                                                                                            |
| GET    | `/api/v1/products`                         | query, below          | 200, a page           | 400 `VALIDATION_FAILED`                                                                                                                                                                     |
| GET    | `/api/v1/products/counts`                  | —                     | 200, count per filter | —                                                                                                                                                                                           |
| GET    | `/api/v1/products/:id`                     | —                     | 200, the product      | 404 `PRODUCT_NOT_FOUND`                                                                                                                                                                     |
| PUT    | `/api/v1/products/:id`                     | `saveProductSchema`   | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `PRODUCT_OPTION_NOT_FOUND` / `VARIANT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`, 409 `PRODUCT_STALE` / `SKU_TAKEN` |
| PATCH  | `/api/v1/products/:id`                     | `updateProductSchema` | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `DELIVERY_CHARGE_NOT_FOUND`                                                                                       |
| PATCH  | `/api/v1/products/:id/variants/:variantId` | `updateVariantSchema` | 200, the product      | 400 `VALIDATION_FAILED`, 404 `PRODUCT_NOT_FOUND` / `VARIANT_NOT_FOUND` / `PRODUCT_IMAGE_NOT_FOUND`, 409 `SKU_TAKEN`                                                                         |
| DELETE | `/api/v1/products/:id`                     | —                     | 204                   | 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_IN_USE`                                                                                                                                               |

A non-UUID `:id` is `400 VALIDATION_FAILED` on every route.

The image routes are in
[`product-images.controller.ts`](../../../apps/api/src/modules/products/images/product-images.controller.ts),
behind the same session and `TenantGuard`.

| Method | Path                                          | Body                     | Success                   | Errors                                                                                                                                                                                                        |
| ------ | --------------------------------------------- | ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/products/:productId/images`          | multipart, field `file`  | 201, the image            | 400 `VALIDATION_FAILED` / `PRODUCT_IMAGE_INVALID`, 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_IMAGE_LIMIT_REACHED`, 413 `PRODUCT_IMAGE_TOO_LARGE`, 415 `PRODUCT_IMAGE_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| DELETE | `/api/v1/products/:productId/images/:imageId` | —                        | 204                       | 400 `VALIDATION_FAILED`, 404 `PRODUCT_IMAGE_NOT_FOUND`                                                                                                                                                        |
| PUT    | `/api/v1/products/:productId/images/order`    | `{ imageIds: string[] }` | 200, the reordered images | 400 `VALIDATION_FAILED` / `PRODUCT_IMAGE_ORDER_MISMATCH`, 404 `PRODUCT_NOT_FOUND`                                                                                                                             |

Upload has its own throttle: 30 requests per minute per client, on top of the
global limit. The image resource is
`{ id, url, thumbnailUrl, position, width, height }`. Products embed `images`
in that shape, ordered by position, so there is no list endpoint. A variant's
image is set through its `imageId`, in a save or a variant update, not through
these routes.

The products list takes the query `filter`, `q`, `categoryId`, `page` and
`limit`, and answers 400 `VALIDATION_FAILED` on an invalid value. It ignores
any other parameter. Its page
size is `limit`, where the newer Customers and Orders lists say `pageSize`.
Both mean the same thing. See [Products list](#products-list).

The category routes are in
[`categories.controller.ts`](../../../apps/api/src/modules/categories/categories.controller.ts),
behind the same session and `TenantGuard`. They return
`{ id, name, productCount }` (`categoryWithCountSchema`), where `productCount`
counts every product linked to the category whatever its status, so it is the
number a delete takes the category off. It can be higher than what the
products list shows for that category, whose default filter leaves archived
products out. The product picker reads the same list. The AI's
`findSellableCatalog` keeps the plain `{ id, name }`. See
[Categories](#categories) for the rules.

| Method | Path                     | Body               | Success            | Errors                                                                       |
| ------ | ------------------------ | ------------------ | ------------------ | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/categories`     | —                  | 200, live, by name | —                                                                            |
| POST   | `/api/v1/categories`     | `{ name: string }` | 201, the category  | 400 `VALIDATION_FAILED`, 409 `CATEGORY_NAME_TAKEN`                           |
| PATCH  | `/api/v1/categories/:id` | `{ name: string }` | 200, the category  | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND`, 409 `CATEGORY_NAME_TAKEN` |
| DELETE | `/api/v1/categories/:id` | —                  | 204                | 400 `VALIDATION_FAILED`, 404 `CATEGORY_NOT_FOUND`                            |

## Errors

All are thrown as `Coded*Exception`s from
[`product-errors.ts`](../../../apps/api/src/modules/products/product-errors.ts),
[`category-errors.ts`](../../../apps/api/src/modules/categories/category-errors.ts),
[`delivery-errors.ts`](../../../apps/api/src/modules/settings/delivery-errors.ts),
the upload interceptor, and
[`s3-object-storage.ts`](../../../apps/api/src/modules/storage/s3-object-storage.ts).

| Code                             | Status | Params           | When                                                         |
| -------------------------------- | ------ | ---------------- | ------------------------------------------------------------ |
| `PRODUCT_NOT_FOUND`              | 404    | `{ id }`         | No such product for this merchant                            |
| `VARIANT_NOT_FOUND`              | 404    | `{ id }`         | No such live variant on the product                          |
| `CATEGORY_NOT_FOUND`             | 404    | `{ id }` or `{}` | Missing or deleted category (as target or link)              |
| `CATEGORY_NAME_TAKEN`            | 409    | `{ name }`       | Name used by another live category, ignoring case            |
| `PRODUCT_OPTION_NOT_FOUND`       | 404    | `{ id }`         | A save names an option or value id that isn't this product's |
| `PRODUCT_STALE`                  | 409    | `{ id }`         | A save's `version` isn't the product's current one           |
| `PRODUCT_IN_USE`                 | 409    | `{ id }`         | Deleting a product an order line references                  |
| `SKU_TAKEN`                      | 409    | `{ sku }`        | Typed SKU already used by a live variant                     |
| `DELIVERY_CHARGE_NOT_FOUND`      | 404    | `{ id }`         | A product's own charge names an area the shop doesn't have   |
| `PRODUCT_IMAGE_TOO_LARGE`        | 413    | `{ maxBytes }`   | Upload over 10 MB                                            |
| `PRODUCT_IMAGE_UNSUPPORTED_TYPE` | 415    | —                | Not JPEG, PNG or WebP                                        |
| `PRODUCT_IMAGE_INVALID`          | 400    | —                | Undecodable, over 40 MP, or not exactly one file in `file`   |
| `PRODUCT_IMAGE_LIMIT_REACHED`    | 409    | `{ max }`        | Product already has 8 images                                 |
| `PRODUCT_IMAGE_ORDER_MISMATCH`   | 400    | —                | Reorder ids aren't a permutation of the current images       |
| `PRODUCT_IMAGE_NOT_FOUND`        | 404    | `{ id }`         | No such image on this product, or a variant's foreign image  |
| `STORAGE_UNAVAILABLE`            | 503    | —                | R2 rejected or failed a request                              |

A product document's own rules answer `400 VALIDATION_FAILED` with field
codes rather than top-level ones: `DUPLICATE`, `UNKNOWN_OPTION_VALUE`,
`OPTION_VALUES_MISMATCH` and `VARIANTS_NEED_OPTION` (see
[The product document](#the-product-document)).

Each new code is a three-file change: `packages/shared/src/errors/codes.ts`,
`apps/web/src/i18n/error-keys.ts` and `apps/web/src/i18n/locales/en/errors.json`
(see `AGENTS.md`).

## Shared contract

[`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts)
is used by both apps:

- **Resources.** `productSchema` (with `options`, `variants`, `categoryIds`,
  `images`, `coverImageId`, `version`), `productOptionSchema`,
  `variantSchema` (with derived `stockStatus` and `optionValueIds`),
  `categorySchema`, `categoryWithCountSchema`, `productImageSchema`, and the
  list's `productListItemSchema` and `productCountsSchema`.
- **Inputs.** `createProductSchema` and `saveProductSchema` (the document,
  whose status defaults to `draft`, both running `refineProductDocument`),
  `productOptionInputSchema`, `productVariantInputSchema`,
  `updateProductSchema`, `updateVariantSchema`, `listProductsQuerySchema`,
  `createCategorySchema`, `updateCategorySchema`, `reorderProductImagesSchema`,
  `productCsvRowSchema`.
- **Constants.** `PRODUCT_IMAGE_MAX_BYTES` (10 MB),
  `PRODUCT_IMAGE_MAX_COUNT` (8), `PRODUCT_OPTION_MAX_COUNT` (3),
  `PRODUCT_OPTION_VALUE_MAX_COUNT` (30), `PRODUCT_VARIANT_MAX_COUNT` (100),
  `LOW_STOCK_THRESHOLD` (5).
- **Enums.** `productStatusSchema` and `stockStatusSchema`. Each has an entry
  in `apps/web/src/i18n/status-keys.ts`.

After changing it, run `pnpm --filter @app/shared build`, because `apps/api`
resolves `@app/shared` through its built `dist`.

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts),
set in `environments/.env`. All are required except `STORAGE_REGION`:

| Variable                    | Notes                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `STORAGE_ENDPOINT`          | S3 API endpoint of the bucket (Cloudflare R2)                               |
| `STORAGE_REGION`            | Defaults to `auto`                                                          |
| `STORAGE_BUCKET`            | Development has its own bucket; never point a local `.env` at production    |
| `STORAGE_ACCESS_KEY_ID`     | A token scoped to that one bucket                                           |
| `STORAGE_SECRET_ACCESS_KEY` | Redacted from logs (`*.secretAccessKey` in the pino config)                 |
| `STORAGE_PUBLIC_BASE_URL`   | Public base for image URLs: the custom domain in production, never `r2.dev` |

[`StorageModule`](../../../apps/api/src/modules/storage/storage.module.ts) is
the only code that imports `@aws-sdk/*`, behind the `ObjectStorage` interface.
Tests swap it for an in-memory fake. The client computes checksums only when
required, which R2 needs, and bounds each request (5 s connect, 30 s request).

## Security notes

- **Tenant isolation at three layers.** `TenantGuard` sets the merchant from
  the session, every repository filters by it, and forced RLS backs both up.
  Composite foreign keys also stop a row from _pointing at_ another merchant's
  row, which RLS alone doesn't catch.
- **Nothing private leaves in a photo.** Every upload is decoded and
  re-encoded. EXIF (including GPS), XMP and ICC are dropped. The format is
  sniffed by `sharp`, never taken from the client.
- **Storage keys are server-made.** No request field reaches a key, so a
  request can't write or delete outside its merchant's prefix.
- **The sweep fails safe.** Unparseable keys, recent objects and mass deletions
  are all left alone.

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

The database-backed specs are **skipped** unless `TEST_DATABASE_ADMIN_URL` is
set (see `environments/.env.example`). The Jest run creates and migrates that
database itself. CI sets it. No test contacts R2. Locally:

```bash
pnpm dev:up
```

```bash
pnpm --filter api test -- catalog products categories
```

## Dev seed

`pnpm --filter api db:seed-products [--org <slug>] [--count <n>] [--reset]`
fills a shop's catalog for development:

- **About 20 hand-written products** from a Dhaka clothing shop, across five
  categories, covering what the dashboard and the assistant must handle: one
  to three options, sold-out variants, Banglish aliases, drafts, an archived
  product, and custom delivery charges (the shop's charges plus a surcharge,
  so only areas the shop already has).
- **`--count <n>`** adds generated products, numbered after the last run's
  (`… #21`), from a fixed-seed generator. Generated products have no photos.
- **`--reset`** deletes the shop's products first. A product an order points
  at is kept (`PRODUCT_IN_USE`).

`--org` takes the shop's slug, which is its organization id. Leave it out when
the database has one shop. A slug that matches no shop prints the list of
shops. Everything goes through
`ProductsService` and `CategoriesService` as `app_runtime`, so seeded rows pass
the dashboard's validation and RLS. Re-running is safe: categories and
hand-written products that exist by name are reused or skipped. The command
refuses unless `NODE_ENV=development` and `DATABASE_URL` is local. It compiles
with SWC into `dist/seed`, leaving the running dev server's `dist` alone.

## Dashboard

- **`/catalog`**: the products list (see [Products list](#products-list)).
- **`/catalog/products/new`** and **`/catalog/products/$productId`**: basic
  details, the option editor and variant table, the variant image picker,
  status, categories and aliases (shown as Tags), the Delivery charge card
  (shop charges, or a custom charge per area with the shop charge beside it),
  and the photo dialogs. Those are Add photos with per-file progress, All
  photos with delete and the default choice, and a full-screen viewer. The
  default photo (the cover) is saved with the page, but uploads and deletes
  happen at once. A save sends the product's `version`. A `PRODUCT_STALE`
  answer means another save or an order changed the product since the page
  read it.
- **`/catalog/categories`**: the Categories page (see
  [Categories page](#categories-page)).

## Not yet built

- **Dashboard extras.** Three pieces are missing:
  - Reordering photos.
  - The Categories page's insights panel: what customers ask for, categories
    they ask for that don't exist, and the needs-attention list.
  - Fields the design shows that the API doesn't hold yet: the assistant
    notes, a per-seller low-stock threshold, and sales figures.

  The design's product-level "Free delivery" option was left out on purpose.
  The only free delivery is the shop's threshold.

- **CSV import.** Only `productCsvRowSchema` exists. CSV carries no images or
  categories.
- **Categories in the assistant.** `findSellableCatalog` returns them, but
  the assistant's matching ([phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#matching))
  uses only names, aliases and option values. Browsing by category is
  phase 3.
- **Bulk object removal on account deletion.** The `m/{merchantId}/` prefix
  makes it one prefix delete.

## Key files

- [`apps/api/src/modules/database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts): all eight tables
- [`apps/api/src/modules/categories/categories.service.ts`](../../../apps/api/src/modules/categories/categories.service.ts): create, rename, delete
- [`apps/api/src/modules/categories/categories.repository.ts`](../../../apps/api/src/modules/categories/categories.repository.ts): category lock, soft delete
- [`apps/api/src/modules/products/products.service.ts`](../../../apps/api/src/modules/products/products.service.ts): product and variant rules, `findSellableCatalog`
- [`apps/api/src/modules/products/products.repository.ts`](../../../apps/api/src/modules/products/products.repository.ts): queries, SKU generation retries
- [`apps/api/src/modules/products/options/product-document-plan.ts`](../../../apps/api/src/modules/products/options/product-document-plan.ts): what a document save keeps, creates and archives
- [`apps/api/src/modules/products/options/product-writer.ts`](../../../apps/api/src/modules/products/options/product-writer.ts): applies the plan
- [`apps/api/src/modules/products/images/product-images.service.ts`](../../../apps/api/src/modules/products/images/product-images.service.ts): upload, delete, reorder
- [`apps/api/src/modules/products/images/normalize-product-image.ts`](../../../apps/api/src/modules/products/images/normalize-product-image.ts): `sharp` pipeline
- [`apps/api/src/modules/products/images/sweep-orphaned-images.ts`](../../../apps/api/src/modules/products/images/sweep-orphaned-images.ts): orphan sweep
- [`apps/api/src/modules/storage/storage.module.ts`](../../../apps/api/src/modules/storage/storage.module.ts): R2 client
- [`apps/api/db/seed/product-seeder.ts`](../../../apps/api/db/seed/product-seeder.ts): the dev seed, whose catalog is in [`seed-catalog.ts`](../../../apps/api/db/seed/seed-catalog.ts)
- [`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts): shared contract
