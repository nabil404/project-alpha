# 02 · Product catalog

How a seller's products, variants, categories and photos are stored, kept
consistent, and read back by the dashboard and the AI. Scope comes from the
MVP's [scope](../../mvp/01-messenger-to-order/scope.md) and
[data model](../../mvp/01-messenger-to-order/domain.md#data-model). The designs
behind it are the
[catalog data model](../../superpowers/specs/2026-09-27-catalog-data-model-design.md)
and [product image storage](../../superpowers/specs/2026-09-27-product-image-storage-design.md)
specs. This page describes what is actually built.

**Status (Sep 2026):** the data layer is done. That covers five tables with
composite tenant keys and forced row-level security, `CategoriesService` and
`ProductsService` with every rule below (including the AI's
`findSellableCatalog` read), product image upload/delete/reorder over HTTP,
object storage on Cloudflare R2, and a daily orphan sweep in the worker. Not
built yet: HTTP routes for products, variants and categories, the dashboard
catalog UI, CSV import, and stock movement on orders (see
[Not yet built](#not-yet-built)).

## At a glance

| Concern          | Decision                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tables           | `product`, `product_variant`, `category`, `product_category`, `product_image`                                       |
| Tenant integrity | Composite foreign keys on `(merchant_id, id)` so no row can point at another merchant's row; RLS forced on all five |
| Lifecycle        | Product `status` (`draft` / `active` / `archived`); variants archived (`archived_at`); categories soft-deleted      |
| Sellable         | The AI sees only `active` products, their live variants and live categories                                         |
| Money            | Integer minor units (`price`, `delivery_charge`), never floats                                                      |
| Variants         | At least one live per product; a product without options has one unnamed default variant                            |
| SKU              | Required, unique per merchant among live variants, case-insensitive; generated when left blank                      |
| Categories       | A tree at most 3 levels deep (`CATEGORY_MAX_DEPTH`); a product can sit in several                                   |
| Images           | Up to 8 per product, 10 MB per upload, re-encoded by `sharp`, stored in R2 through the S3 API                       |

## Data model

Defined in
[`database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts).
Every table has a `text` UUID `id` (the junction table has none), a
`merchant_id` referencing `organization(id)`, `created_at`, and a
`<table>_merchant_isolation` policy on `merchant_id = app_current_merchant()`.
Every table also has `UNIQUE (merchant_id, id)`, which the composite foreign
keys point at. RLS filters reads, but it does not check the ids a row points
at. The composite keys do that, so a bug that writes another merchant's
`product_id` or `parent_id` fails in the database.

| Table              | Key columns                                                                                             | Constraints worth knowing                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `product`          | `name`, `description`, `aliases text[]`, `status`, `delivery_charge`                                    | `status` check; `delivery_charge >= 0`                                                                                                                                                                                         |
| `product_variant`  | `product_id`, `name` (null = default), `sku`, `price`, `stock`, `is_default`, `image_id`, `archived_at` | FK to product `ON DELETE CASCADE`; `price`, `stock >= 0`; `is_default = (name IS NULL)`; partial unique `(merchant_id, sku) WHERE archived_at IS NULL`; partial unique `(product_id) WHERE is_default AND archived_at IS NULL` |
| `category`         | `parent_id`, `name`, `deleted_at`                                                                       | Self FK on `(merchant_id, parent_id)` (`MATCH SIMPLE`, so roots need nothing); not its own parent; partial unique `(merchant_id, lower(name)) WHERE deleted_at IS NULL`                                                        |
| `product_category` | PK `(merchant_id, product_id, category_id)`                                                             | FK to product `ON DELETE CASCADE`; FK to category                                                                                                                                                                              |
| `product_image`    | `product_id`, `storage_key`, `position`, `width`, `height`, `byte_size`                                 | FK to product `ON DELETE CASCADE`; `storage_key` unique; `position` dense `0..n-1`, `0` is the cover, deliberately not unique so a reorder needs no deferral                                                                   |

`product_variant.image_id` references `product_image (merchant_id, id)`
`ON DELETE SET NULL (image_id)`. drizzle-kit can't model the column list, and a
plain composite `SET NULL` would also null `merchant_id` and fail its
`NOT NULL`. So that key lives in a custom migration, not in `catalog.ts`.

Migrations:

| Migration                                                                                                    | What                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`0003_catalog.sql`](../../../apps/api/db/migrations/0003_catalog.sql)                                       | Generated: the four catalog tables, `ENABLE` RLS, policies                |
| [`0004_catalog_force_rls.sql`](../../../apps/api/db/migrations/0004_catalog_force_rls.sql)                   | Custom: `FORCE ROW LEVEL SECURITY` on those four                          |
| [`0005_product_image.sql`](../../../apps/api/db/migrations/0005_product_image.sql)                           | Generated: `product_image`, `product_variant.image_id`                    |
| [`0006_product_image_fk_force_rls.sql`](../../../apps/api/db/migrations/0006_product_image_fk_force_rls.sql) | Custom: `FORCE` on `product_image`, the `SET NULL (image_id)` variant key |

The index names `VARIANT_SKU_LIVE_UIDX` and `CATEGORY_NAME_LIVE_UIDX` are
exported from the schema, because the services map unique violations on them to
coded errors.

## Rules

Two Nest modules, [`modules/categories/`](../../../apps/api/src/modules/categories/)
and [`modules/products/`](../../../apps/api/src/modules/products/), each with a
repository and a service. The dependency runs one way: `ProductsModule` imports
`CategoriesModule` for `CategoriesRepository` (the tree lock and liveness
checks). Categories never import from products. Every repository method takes
an `Executor` and a `TenantScope` and filters by `merchantId`. Every service
method runs inside `withMerchant`.

### Category tree

Any write that sets a parent (create with a parent, or move) first takes
`pg_advisory_xact_lock(hashtextextended('category:<merchantId>', 0))`
(`CategoriesRepository.lockTree`), then:

1. The parent must be live, else `CATEGORY_NOT_FOUND`.
2. `chainToRoot` walks the parent's ancestors with a recursive CTE. If the
   category being moved is on that chain → `CATEGORY_CYCLE`.
3. The parent's depth plus the height of the moved subtree (`subtreeHeight`; a
   new category is 1) must not exceed `CATEGORY_MAX_DEPTH`, else
   `CATEGORY_TOO_DEEP`.

The lock serializes tree writes per merchant, so two opposite moves (A under B,
B under A) can't both pass the cycle check. `parentId: null` moves a category
to the root; omitting `parentId` leaves it where it is.

**Delete** is a soft delete under the same lock. It's refused with
`CATEGORY_HAS_CHILDREN` while live subcategories exist. Otherwise it sets
`deleted_at` and hard-deletes the category's `product_category` rows in the
same transaction, so no junction join can surface a deleted category.

**Names** are trimmed. A clash with another live category of the same merchant,
anywhere in the tree and ignoring case, → `CATEGORY_NAME_TAKEN`. That is mapped
from the unique index rather than pre-checked, so two racing requests can't
both take the name. Deleting a category releases its name.

### Variants

- **At least one live variant.** Creating a product with none, or archiving the
  last one → `PRODUCT_NEEDS_VARIANT`.
- **Default variant.** A product created with one unnamed variant makes it the
  default. With more than one, all must be named (`VARIANT_NAME_REQUIRED`).
  Adding a variant to a product whose only live variant is the default requires
  `defaultVariantName` in the same call, which names it and clears its flag.
  `name: null` is accepted on update only for a product's single live variant.
- **SKU.** Trimmed and upper-cased on write ([`sku.ts`](../../../apps/api/src/modules/products/sku.ts)).
  A blank SKU is generated as `SKU-` plus 8 Crockford base32 characters (no I,
  L, O or U), inserted with `ON CONFLICT DO NOTHING` and retried up to 5 times.
  A SKU the seller typed that a live variant already uses → `SKU_TAKEN`.
  Archiving a variant releases its SKU.
- **Archive, never delete.** Order lines will reference variants, so a variant
  is archived. That also stops the AI from calling a discontinued option "out
  of stock".
- **Image.** `imageId` must be one of the same product's images, else
  `PRODUCT_IMAGE_NOT_FOUND`. The composite key already keeps it inside the
  merchant. `null` falls back to the product's cover.
- **Stock** is written by the seller only. The derived `stockStatus`
  (`in_stock` / `out_of_stock`) is computed on read.

Every variant change locks the product row first (`findProduct(…, { lock: true })`),
so two concurrent archives can't both pass the last-variant check.

### Products

- `status` moves freely between `draft`, `active` and `archived`.
- `categoryIds` on create or update **replaces** the product's links. It is
  checked for liveness under the category tree lock, so a category can't be
  deleted between the check and the link (`CATEGORY_NOT_FOUND`).
- **Hard delete** cascades to variants, category links and image rows. The
  image objects are deleted from storage after commit, best-effort. Once orders
  exist, their `RESTRICT` key to `product_variant` will make the database refuse
  this, and the seller archives instead.

### Visibility

Drizzle has no automatic soft-delete filter, so every read uses a named
predicate:

| Helper            | Predicate             | File                                                                                        |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `liveVariant`     | `archived_at IS NULL` | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `sellableProduct` | `status = 'active'`   | [`product-visibility.ts`](../../../apps/api/src/modules/products/product-visibility.ts)     |
| `liveCategory`    | `deleted_at IS NULL`  | [`category-visibility.ts`](../../../apps/api/src/modules/categories/category-visibility.ts) |

- **`ProductsService.findSellableCatalog(merchantId)`**, the AI's read, returns
  active products with their live variants, category ids and images, plus the
  merchant's live categories.
- **Dashboard reads** (`get`, and the result of every write) return a product
  of any status, but never archived variants or deleted categories.

## Product images

Handled by [`products/images/`](../../../apps/api/src/modules/products/images/).
Photos go to customers through Meta, so each one has a stable public URL, and
nothing of the upload survives except the pixels.

### Upload sequence

No `sharp` or storage call ever runs inside a database transaction (backend
invariant #1). [`ProductImagesService.upload`](../../../apps/api/src/modules/products/images/product-images.service.ts):

1. **Pre-check.** The product exists for this merchant (`PRODUCT_NOT_FOUND`)
   and has fewer than 8 images (`PRODUCT_IMAGE_LIMIT_REACHED`).
2. **Receive.** Multer memory storage, one file in `file`, rejected while
   streaming past 10 MB, so an oversize upload is never fully buffered. Multer's
   bare exceptions are translated to coded ones by
   [`ProductImageUploadInterceptor`](../../../apps/api/src/modules/products/images/product-image-upload.interceptor.ts).
3. **Normalize** with [`normalizeProductImage`](../../../apps/api/src/modules/products/images/normalize-product-image.ts).
   The format comes from `sharp`'s detection, never the client's MIME type.
   JPEG, PNG and WebP are accepted; anything else (HEIC, GIF) is unsupported.
   Over 40 megapixels or undecodable is invalid. EXIF orientation is applied,
   alpha is flattened onto white, and all metadata (GPS, XMP, ICC) is dropped.
   The full image fits inside 2048×2048 at JPEG q82, the thumbnail inside
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

- **Delete:** one transaction locks the product, deletes the row and rewrites
  the remaining positions to `0..n-1`. The objects are deleted after commit;
  a failure is logged and left to the sweep. Another merchant's product answers
  exactly like a missing image.
- **Reorder:** one transaction locks the product and checks that `imageIds` is
  a permutation of the current ids (`PRODUCT_IMAGE_ORDER_MISMATCH` otherwise).
  It then rewrites positions. The first id becomes the cover.

### Orphan sweep

An object with no row appears only when a best-effort delete fails.
[`StorageSweepProcessor`](../../../apps/api/src/modules/products/images/storage-sweep.processor.ts)
runs [`sweepOrphanedImages`](../../../apps/api/src/modules/products/images/sweep-orphaned-images.ts)
daily at 03:00 UTC, via the BullMQ job scheduler `sweep-orphaned-images-daily`.
The scheduler is upserted on every worker boot, so there is only ever one. The
processor is registered only in the worker, never in the API process.

- It pages through `m/`. **A key that doesn't parse is skipped, never
  deleted.**
- It looks up surviving ids per merchant **inside `withMerchant`**. Under
  forced RLS, a lookup without merchant context sees no rows and would treat
  every object as an orphan.
- Objects younger than 24 hours are left alone, because their upload may not
  have committed yet.
- **Circuit breaker:** if orphans exceed 20% of the objects examined _and_
  number more than 10, nothing is deleted and an error is logged.

## HTTP surface

Only the image routes are exposed so far
([`product-images.controller.ts`](../../../apps/api/src/modules/products/images/product-images.controller.ts)).
They need a session and carry `TenantGuard`, so the merchant always comes from
the session.

| Method | Path                                          | Body                     | Success                   | Errors                                                                                                                                             |
| ------ | --------------------------------------------- | ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/products/:productId/images`          | multipart, field `file`  | 201, the image            | 400 `VALIDATION_FAILED` / `PRODUCT_IMAGE_INVALID`, 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_IMAGE_LIMIT_REACHED`, 413, 415, 503 `STORAGE_UNAVAILABLE` |
| DELETE | `/api/v1/products/:productId/images/:imageId` | —                        | 204                       | 404 `PRODUCT_IMAGE_NOT_FOUND`                                                                                                                      |
| PUT    | `/api/v1/products/:productId/images/order`    | `{ imageIds: string[] }` | 200, the reordered images | 400 `PRODUCT_IMAGE_ORDER_MISMATCH`, 404 `PRODUCT_NOT_FOUND`                                                                                        |

Upload has its own throttle: 30 requests per minute per client, on top of the
global limit. The image resource is
`{ id, url, thumbnailUrl, position, width, height }`. Products embed `images`
in that shape, ordered by position, so there is no list endpoint. A variant's
image is set through the variant update (`imageId`), not these routes.

The product, variant and category services have no controller yet. Their
inputs are already the shared schemas below, ready for one.

## Errors

All are thrown as `Coded*Exception`s from
[`product-errors.ts`](../../../apps/api/src/modules/products/product-errors.ts),
[`category-errors.ts`](../../../apps/api/src/modules/categories/category-errors.ts),
the categories service, the upload interceptor, and
[`s3-object-storage.ts`](../../../apps/api/src/modules/storage/s3-object-storage.ts).

| Code                             | Status | Params           | When                                                        |
| -------------------------------- | ------ | ---------------- | ----------------------------------------------------------- |
| `PRODUCT_NOT_FOUND`              | 404    | `{ id }`         | No such product for this merchant                           |
| `VARIANT_NOT_FOUND`              | 404    | `{ id }`         | No such live variant on the product                         |
| `CATEGORY_NOT_FOUND`             | 404    | `{ id }` or `{}` | Missing or deleted category (as target, parent or link)     |
| `CATEGORY_CYCLE`                 | 409    | —                | Move under itself or a descendant                           |
| `CATEGORY_TOO_DEEP`              | 409    | `{ max }`        | Result would exceed 3 levels                                |
| `CATEGORY_HAS_CHILDREN`          | 409    | `{ id }`         | Deleting a category with live subcategories                 |
| `CATEGORY_NAME_TAKEN`            | 409    | `{ name }`       | Name used by another live category, ignoring case           |
| `PRODUCT_NEEDS_VARIANT`          | 409    | `{ id }` or `{}` | No variants on create, or archiving the last live one       |
| `VARIANT_NAME_REQUIRED`          | 400    | —                | An unnamed variant where the product has (or gets) several  |
| `SKU_TAKEN`                      | 409    | `{ sku }`        | Typed SKU already used by a live variant                    |
| `PRODUCT_IMAGE_TOO_LARGE`        | 413    | `{ maxBytes }`   | Upload over 10 MB                                           |
| `PRODUCT_IMAGE_UNSUPPORTED_TYPE` | 415    | —                | Not JPEG, PNG or WebP                                       |
| `PRODUCT_IMAGE_INVALID`          | 400    | —                | Undecodable, over 40 MP, or not exactly one file in `file`  |
| `PRODUCT_IMAGE_LIMIT_REACHED`    | 409    | `{ max }`        | Product already has 8 images                                |
| `PRODUCT_IMAGE_ORDER_MISMATCH`   | 400    | —                | Reorder ids aren't a permutation of the current images      |
| `PRODUCT_IMAGE_NOT_FOUND`        | 404    | `{ id }`         | No such image on this product, or a variant's foreign image |
| `STORAGE_UNAVAILABLE`            | 503    | —                | R2 rejected or failed a request                             |

Each new code is a three-file change: `packages/shared/src/errors/codes.ts`,
`apps/web/src/i18n/error-keys.ts` and `apps/web/src/i18n/locales/en/errors.json`
(see `AGENTS.md`).

## Shared contract

[`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts)
is used by both apps:

- **Resources:** `productSchema` (with `variants`, `categoryIds`, `images`),
  `variantSchema` (with derived `stockStatus`), `categorySchema`,
  `productImageSchema`.
- **Inputs:** `createProductSchema` (status defaults to `draft`; refines that
  every variant is named when there are several), `updateProductSchema`,
  `addVariantSchema`, `updateVariantSchema`, `createCategorySchema`,
  `updateCategorySchema`, `reorderProductImagesSchema`, `productCsvRowSchema`.
- **Constants:** `CATEGORY_MAX_DEPTH` (3), `PRODUCT_IMAGE_MAX_BYTES` (10 MB),
  `PRODUCT_IMAGE_MAX_COUNT` (8).
- **Enums:** `productStatusSchema` and `stockStatusSchema`. Each has an entry
  in `apps/web/src/i18n/status-keys.ts`.

After changing it, run `pnpm --filter @app/shared build`: `apps/api` resolves
`@app/shared` through its built `dist`.

## Configuration

From [`config/env.schema.ts`](../../../apps/api/src/modules/config/env.schema.ts), all
required, set in `apps/api/.env`:

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

| Spec                                                                                                                                       | Covers                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`database/__tests__/catalog-schema.spec.ts`](../../../apps/api/src/modules/database/__tests__/catalog-schema.spec.ts)                     | Constraints: composite keys, checks, partial unique indexes                                            |
| [`database/__tests__/catalog-rls.spec.ts`](../../../apps/api/src/modules/database/__tests__/catalog-rls.spec.ts)                           | Two-merchant isolation under RLS                                                                       |
| [`categories/__tests__/categories.service.spec.ts`](../../../apps/api/src/modules/categories/__tests__/categories.service.spec.ts)         | Tree rules, concurrent opposite moves, delete, name clashes                                            |
| [`products/__tests__/products.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/products.service.spec.ts)                 | Product create, update, delete, category links                                                         |
| [`products/__tests__/product-variants.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-variants.service.spec.ts) | Last-variant guard, default-variant rule, SKUs, variant images                                         |
| [`products/__tests__/product-gallery.service.spec.ts`](../../../apps/api/src/modules/products/__tests__/product-gallery.service.spec.ts)   | Images embedded in products; object cleanup on product delete                                          |
| [`products/__tests__/sellable-catalog.spec.ts`](../../../apps/api/src/modules/products/__tests__/sellable-catalog.spec.ts)                 | `findSellableCatalog` visibility                                                                       |
| [`products/__tests__/sku.spec.ts`](../../../apps/api/src/modules/products/__tests__/sku.spec.ts)                                           | SKU normalization and generation                                                                       |
| [`products/images/__tests__/`](../../../apps/api/src/modules/products/images/__tests__/)                                                   | Normalization, keys, interceptor, repository, service, sweep, and a multipart e2e through the Nest app |
| [`storage/__tests__/s3-object-storage.spec.ts`](../../../apps/api/src/modules/storage/__tests__/s3-object-storage.spec.ts)                 | The S3 adapter and its error mapping                                                                   |

The database-backed specs are **skipped** unless `DATABASE_ADMIN_URL` is set.
CI sets it. No test contacts R2. Locally:

```bash
pnpm dev:up
```

```bash
DATABASE_ADMIN_URL=postgres://… pnpm --filter api test -- catalog products categories
```

## Not yet built

- **Catalog HTTP routes** for products, variants and categories, with OpenAPI.
  The services and input schemas are ready.
- **Dashboard UI.** `/catalog` renders only its title. The product list and
  edit page, the image gallery, and the variant image picker all wait on it.
- **CSV import.** Only `productCsvRowSchema` exists. CSV carries no images or
  categories.
- **Stock movement.** Decrement on order confirmation (row lock, reject if
  insufficient) and restore on cancellation land with the orders work.
- **AI prompt wiring.** `findSellableCatalog` returns what the prompt needs,
  including categories. The LLM work consumes it.
- **Bulk object removal on account deletion.** The `m/{merchantId}/` prefix
  makes it one prefix delete.

## Key files

- [`apps/api/src/modules/database/schema/catalog.ts`](../../../apps/api/src/modules/database/schema/catalog.ts): all five tables
- [`apps/api/src/modules/categories/categories.service.ts`](../../../apps/api/src/modules/categories/categories.service.ts): tree rules
- [`apps/api/src/modules/categories/categories.repository.ts`](../../../apps/api/src/modules/categories/categories.repository.ts): tree lock, recursive walks, soft delete
- [`apps/api/src/modules/products/products.service.ts`](../../../apps/api/src/modules/products/products.service.ts): product and variant rules, `findSellableCatalog`
- [`apps/api/src/modules/products/products.repository.ts`](../../../apps/api/src/modules/products/products.repository.ts): queries, SKU generation retries
- [`apps/api/src/modules/products/images/product-images.service.ts`](../../../apps/api/src/modules/products/images/product-images.service.ts): upload, delete, reorder
- [`apps/api/src/modules/products/images/normalize-product-image.ts`](../../../apps/api/src/modules/products/images/normalize-product-image.ts): `sharp` pipeline
- [`apps/api/src/modules/products/images/sweep-orphaned-images.ts`](../../../apps/api/src/modules/products/images/sweep-orphaned-images.ts): orphan sweep
- [`apps/api/src/modules/storage/storage.module.ts`](../../../apps/api/src/modules/storage/storage.module.ts): R2 client
- [`packages/shared/src/schemas/catalog.ts`](../../../packages/shared/src/schemas/catalog.ts): shared contract
