import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, merchantIsolation, updatedAt } from './columns';

/**
 * The catalog: products, their variants, a category tree, and product↔category
 * links. Every child points at its parent through a composite
 * (merchant_id, id) foreign key, so no row can reference another merchant's
 * row - RLS filters reads but does not validate the ids a row points at.
 */

/** Index names the services map unique violations from. */
export const VARIANT_SKU_LIVE_UIDX = 'product_variant_merchant_sku_live_uidx';
export const CATEGORY_NAME_LIVE_UIDX = 'category_merchant_name_live_uidx';
/** Named for readability in `\d`/pg_indexes; fixed by migration 0003, not mapped by any service. */
const VARIANT_DEFAULT_LIVE_UIDX = 'product_variant_default_live_uidx';

export const product = pgTable(
  'product',
  {
    id: id(),
    merchantId: merchantId(),
    name: text('name').notNull(),
    description: text('description'),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),
    deliveryCharge: integer('delivery_charge').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_merchant_id_uq').on(t.merchantId, t.id),
    check('product_status_ck', sql`${t.status} in ('draft', 'active', 'archived')`),
    check('product_delivery_charge_ck', sql`${t.deliveryCharge} >= 0`),
    index('product_merchant_status_idx').on(t.merchantId, t.status),
    index('product_merchant_created_idx').on(t.merchantId, t.createdAt),
    merchantIsolation('product_merchant_isolation', t.merchantId),
  ],
);

export const productVariant = pgTable(
  'product_variant',
  {
    id: id(),
    merchantId: merchantId(),
    productId: text('product_id').notNull(),
    /** Null exactly for the default variant. */
    name: text('name'),
    sku: text('sku').notNull(),
    price: integer('price').notNull(),
    stock: integer('stock').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * One of the product's own images, or null for the product's cover. Its
     * foreign key, (merchant_id, image_id) -> product_image ON DELETE SET NULL
     * (image_id), lives in migration 0006: drizzle-kit cannot model the column
     * list, and a plain composite SET NULL would null merchant_id too. The
     * service enforces the same product.
     */
    imageId: text('image_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_variant_merchant_id_uq').on(t.merchantId, t.id),
    foreignKey({
      name: 'product_variant_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }).onDelete('cascade'),
    check('product_variant_price_ck', sql`${t.price} >= 0`),
    check('product_variant_stock_ck', sql`${t.stock} >= 0`),
    check('product_variant_default_unnamed_ck', sql`${t.isDefault} = (${t.name} is null)`),
    uniqueIndex(VARIANT_SKU_LIVE_UIDX)
      .on(t.merchantId, t.sku)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex(VARIANT_DEFAULT_LIVE_UIDX)
      .on(t.productId)
      .where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    index('product_variant_merchant_product_idx').on(t.merchantId, t.productId),
    merchantIsolation('product_variant_merchant_isolation', t.merchantId),
  ],
);

/**
 * A product's photo gallery. The objects live in object storage at keys built
 * from (merchant_id, id); storage_key is the full image's, and the thumbnail's
 * is derived. position is dense (0..n-1) and 0 is the cover; it is deliberately
 * not unique, so a reorder rewrites positions without deferral.
 */
export const productImage = pgTable(
  'product_image',
  {
    // Set by the service, which needs the id to build the storage key first.
    id: text('id').primaryKey(),
    merchantId: merchantId(),
    productId: text('product_id').notNull(),
    storageKey: text('storage_key').notNull(),
    position: integer('position').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_image_merchant_id_uq').on(t.merchantId, t.id),
    unique('product_image_storage_key_uq').on(t.storageKey),
    foreignKey({
      name: 'product_image_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }).onDelete('cascade'),
    index('product_image_merchant_product_position_idx').on(t.merchantId, t.productId, t.position),
    merchantIsolation('product_image_merchant_isolation', t.merchantId),
  ],
);

export type ProductImageRow = typeof productImage.$inferSelect;

export const category = pgTable(
  'category',
  {
    id: id(),
    merchantId: merchantId(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('category_merchant_id_uq').on(t.merchantId, t.id),
    // MATCH SIMPLE (the default): a null parent_id skips the check, so roots need nothing.
    foreignKey({
      name: 'category_parent_fk',
      columns: [t.merchantId, t.parentId],
      foreignColumns: [t.merchantId, t.id],
    }),
    check('category_not_own_parent_ck', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    uniqueIndex(CATEGORY_NAME_LIVE_UIDX)
      .on(t.merchantId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('category_merchant_parent_idx').on(t.merchantId, t.parentId),
    merchantIsolation('category_merchant_isolation', t.merchantId),
  ],
);

export const productCategory = pgTable(
  'product_category',
  {
    merchantId: merchantId(),
    productId: text('product_id').notNull(),
    categoryId: text('category_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'product_category_pk', columns: [t.merchantId, t.productId, t.categoryId] }),
    foreignKey({
      name: 'product_category_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'product_category_category_fk',
      columns: [t.merchantId, t.categoryId],
      foreignColumns: [category.merchantId, category.id],
    }),
    index('product_category_merchant_category_idx').on(t.merchantId, t.categoryId),
    merchantIsolation('product_category_merchant_isolation', t.merchantId),
  ],
);
