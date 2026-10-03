import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, instant, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';
import { conversation } from './conversations';
import { customer } from './customers';

/**
 * Orders and their items: the minimum the Customers pages read (counts,
 * totals, the last order, a customer's order list). Provisional - the orders
 * work, which creates them from a confirmed conversation, owns this shape and
 * may change it.
 */

/** A literal copy of @app/shared's orderStatuses (drizzle-kit loads this file on its own); the schema spec keeps them equal. */
const ORDER_STATUSES = ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'] as const;

export const ORDER_NUMBER_UQ = 'order_merchant_number_uq';

/**
 * `number` is the shop's own sequence, shown to the seller and sent to the
 * customer. The delivery fields are a snapshot taken at confirmation, so
 * editing the customer later never rewrites an order. Totals are minor units.
 */
export const order = pgTable(
  'order',
  {
    id: id(),
    merchantId: merchantId(),
    number: integer('number').notNull(),
    customerId: text('customer_id').notNull(),
    /** The conversation it was confirmed in. */
    conversationId: text('conversation_id'),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('new'),
    subtotal: integer('subtotal').notNull(),
    deliveryCharge: integer('delivery_charge').notNull().default(0),
    total: integer('total').notNull(),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    notes: text('notes'),
    placedAt: instant('placed_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('order_merchant_id_uq').on(t.merchantId, t.id),
    unique(ORDER_NUMBER_UQ).on(t.merchantId, t.number),
    foreignKey({
      name: 'order_customer_fk',
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customer.merchantId, customer.id],
    }),
    foreignKey({
      name: 'order_conversation_fk',
      columns: [t.merchantId, t.conversationId],
      foreignColumns: [conversation.merchantId, conversation.id],
    }),
    check('order_status_ck', oneOf(t.status, ORDER_STATUSES)),
    check('order_number_ck', sql`${t.number} > 0`),
    check(
      'order_amounts_ck',
      sql`${t.subtotal} >= 0 and ${t.deliveryCharge} >= 0 and ${t.total} = ${t.subtotal} + ${t.deliveryCharge}`,
    ),
    index('order_customer_placed_idx').on(t.merchantId, t.customerId, t.placedAt.desc(), t.id),
    index('order_merchant_placed_idx').on(t.merchantId, t.placedAt.desc(), t.id),
    merchantIsolation('order_merchant_isolation', t.merchantId),
  ],
);

export type OrderRow = typeof order.$inferSelect;

/**
 * Names and price are snapshots, so an order reads the same after the catalog
 * changes. Products are hard-deleted, so the ids are plain references with no
 * foreign key for now; the orders work decides whether deleting a product that
 * was ordered is refused or keeps the item with its ids cleared.
 */
export const orderItem = pgTable(
  'order_item',
  {
    id: id(),
    merchantId: merchantId(),
    orderId: text('order_id').notNull(),
    productId: text('product_id'),
    variantId: text('variant_id'),
    productName: text('product_name').notNull(),
    /** Null for a product with a single, unnamed variant. */
    variantName: text('variant_name'),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'order_item_order_fk',
      columns: [t.merchantId, t.orderId],
      foreignColumns: [order.merchantId, order.id],
    }).onDelete('cascade'),
    unique('order_item_order_position_uq').on(t.merchantId, t.orderId, t.position),
    check('order_item_quantity_ck', sql`${t.quantity} > 0`),
    check('order_item_unit_price_ck', sql`${t.unitPrice} >= 0`),
    merchantIsolation('order_item_merchant_isolation', t.merchantId),
  ],
);

export type OrderItemRow = typeof orderItem.$inferSelect;
