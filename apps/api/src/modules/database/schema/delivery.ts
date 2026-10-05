import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { product } from './catalog';
import { createdAt, id, merchantId, merchantIsolation, updatedAt } from './columns';

/** Index names the tests and services refer to. */
export const DELIVERY_CHARGE_AREA_UIDX = 'delivery_charge_merchant_area_uidx';
export const DELIVERY_CHARGE_FALLBACK_UIDX = 'delivery_charge_merchant_fallback_uidx';

/**
 * Settings > Delivery charges: what delivery to one area costs and how long
 * it takes, one row per area the shop names, plus one nameless fallback row,
 * "everywhere else", for an address that matches none. Names are stored
 * normalized (@app/shared normalizeAreaName). Orders link here through
 * `order.delivery_charge_id`; removing a row unlinks them (migration 0027)
 * and they keep its name and estimate.
 */
export const deliveryCharge = pgTable(
  'delivery_charge',
  {
    id: id(),
    merchantId: merchantId(),
    /** Null only on the fallback row. */
    areaName: text('area_name'),
    /** The "everywhere else" row; a shop has at most one. */
    isFallback: boolean('is_fallback').notNull().default(false),
    /** Minor units of the shop's currency. */
    charge: integer('charge').notNull(),
    /** What the assistant tells customers, e.g. "1–2 days". */
    deliveryTime: text('delivery_time'),
    /** Where the seller listed it; the fallback always shows last. */
    position: integer('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('delivery_charge_merchant_id_uq').on(t.merchantId, t.id),
    uniqueIndex(DELIVERY_CHARGE_AREA_UIDX)
      .on(t.merchantId, sql`lower(${t.areaName})`)
      .where(sql`not ${t.isFallback}`),
    uniqueIndex(DELIVERY_CHARGE_FALLBACK_UIDX)
      .on(t.merchantId)
      .where(sql`${t.isFallback}`),
    check('delivery_charge_area_name_ck', sql`(${t.areaName} is null) = ${t.isFallback}`),
    check('delivery_charge_charge_ck', sql`${t.charge} >= 0`),
    merchantIsolation('delivery_charge_merchant_isolation', t.merchantId),
  ],
);

export type DeliveryChargeRow = typeof deliveryCharge.$inferSelect;

/**
 * A product's own charge for one area, kept only while the product has
 * `custom_delivery`. An area without a row here costs the shop charge.
 * Removing the product or the area removes the row.
 */
export const productDeliveryCharge = pgTable(
  'product_delivery_charge',
  {
    merchantId: merchantId(),
    productId: text('product_id').notNull(),
    deliveryChargeId: text('delivery_charge_id').notNull(),
    /** Minor units of the shop's currency. */
    charge: integer('charge').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'product_delivery_charge_pk', columns: [t.productId, t.deliveryChargeId] }),
    foreignKey({
      name: 'product_delivery_charge_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'product_delivery_charge_delivery_charge_fk',
      columns: [t.merchantId, t.deliveryChargeId],
      foreignColumns: [deliveryCharge.merchantId, deliveryCharge.id],
    }).onDelete('cascade'),
    check('product_delivery_charge_charge_ck', sql`${t.charge} >= 0`),
    merchantIsolation('product_delivery_charge_merchant_isolation', t.merchantId),
  ],
);

export type ProductDeliveryChargeRow = typeof productDeliveryCharge.$inferSelect;
