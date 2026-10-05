import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { product, productVariant } from './catalog';
import { createdAt, id, instant, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';
import { conversation } from './conversations';
import { customer } from './customers';

/**
 * Orders, their items and their activity. The assistant drafts an order from
 * a confirmed conversation; the seller can also add one by hand.
 */

/**
 * Literal copies of @app/shared's enums (drizzle-kit loads this file on its
 * own); the schema spec keeps them equal.
 */
const ORDER_STATUSES = [
  'new',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
] as const;
const ORDER_SOURCES = ['assistant', 'seller'] as const;
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;
const PAYMENT_METHODS = ['cash_on_delivery', 'bank_transfer', 'mobile_wallet'] as const;
const ORDER_EVENT_TYPES = [
  'created',
  'status_changed',
  'items_changed',
  'delivery_changed',
  'payment_changed',
  'tracking_changed',
] as const;

export const ORDER_NUMBER_UQ = 'order_merchant_number_uq';
export const ORDER_IDEMPOTENCY_UQ = 'order_merchant_idempotency_key_uq';

/**
 * `number` is the shop's own sequence, shown to the seller and sent to the
 * customer. The delivery fields are a snapshot taken when the order is placed,
 * so editing the customer later never rewrites an order. Totals are minor
 * units of `currency`, copied from the shop's settings when the order is placed.
 */
export const order = pgTable(
  'order',
  {
    id: id(),
    merchantId: merchantId(),
    number: integer('number').notNull(),
    customerId: text('customer_id').notNull(),
    /** The conversation it was confirmed in; null for an order the seller added. */
    conversationId: text('conversation_id'),
    source: text('source', { enum: ORDER_SOURCES }).notNull().default('assistant'),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('new'),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('unpaid'),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS })
      .notNull()
      .default('cash_on_delivery'),
    subtotal: integer('subtotal').notNull(),
    deliveryCharge: integer('delivery_charge').notNull().default(0),
    total: integer('total').notNull(),
    /** ISO 4217: the shop's currency when the order was placed. */
    currency: text('currency').notNull(),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    /** The delivery zone's name as it was when charged; zones themselves are not modelled yet. */
    deliveryZone: text('delivery_zone'),
    trackingNumber: text('tracking_number'),
    /** The seller's internal note; the customer never sees it. */
    notes: text('notes'),
    /**
     * Bumped by every write; its `version` on the wire. A change made from an
     * older read is refused, as the product's is.
     */
    revision: integer('revision').notNull().default(0),
    /** The Idempotency-Key a seller-added order was created with; a replay returns it. */
    idempotencyKey: text('idempotency_key'),
    placedAt: instant('placed_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('order_merchant_id_uq').on(t.merchantId, t.id),
    unique(ORDER_NUMBER_UQ).on(t.merchantId, t.number),
    unique(ORDER_IDEMPOTENCY_UQ).on(t.merchantId, t.idempotencyKey),
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
    check('order_source_ck', oneOf(t.source, ORDER_SOURCES)),
    check('order_payment_status_ck', oneOf(t.paymentStatus, PAYMENT_STATUSES)),
    check('order_payment_method_ck', oneOf(t.paymentMethod, PAYMENT_METHODS)),
    check('order_number_ck', sql`${t.number} > 0`),
    check('order_revision_ck', sql`${t.revision} >= 0`),
    check('order_currency_ck', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'order_amounts_ck',
      sql`${t.subtotal} >= 0 and ${t.deliveryCharge} >= 0 and ${t.total} = ${t.subtotal} + ${t.deliveryCharge}`,
    ),
    index('order_customer_placed_idx').on(t.merchantId, t.customerId, t.placedAt.desc(), t.id),
    index('order_merchant_placed_idx').on(t.merchantId, t.placedAt.desc(), t.id),
    index('order_merchant_status_placed_idx').on(t.merchantId, t.status, t.placedAt.desc(), t.id),
    merchantIsolation('order_merchant_isolation', t.merchantId),
  ],
);

export type OrderRow = typeof order.$inferSelect;

/**
 * Names, SKU and price are snapshots, so an order reads the same after the
 * catalog changes. The catalog ids keep their foreign keys with no ON DELETE
 * action: variants are only ever archived, and deleting a product that was
 * ordered is refused (PRODUCT_IN_USE) rather than leaving lines pointing at
 * nothing. The ids are null only on lines written before the keys existed.
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
    sku: text('sku'),
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
    foreignKey({
      name: 'order_item_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }),
    foreignKey({
      name: 'order_item_variant_fk',
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariant.merchantId, productVariant.id],
    }),
    unique('order_item_order_position_uq').on(t.merchantId, t.orderId, t.position),
    check('order_item_quantity_ck', sql`${t.quantity} > 0`),
    check('order_item_unit_price_ck', sql`${t.unitPrice} >= 0`),
    index('order_item_variant_idx').on(t.merchantId, t.variantId),
    merchantIsolation('order_item_merchant_isolation', t.merchantId),
  ],
);

export type OrderItemRow = typeof orderItem.$inferSelect;

/**
 * The order's activity: what changed, when, and which seller did it (null for
 * the assistant, or once the seller's account is deleted). `data` holds the
 * facts the timeline shows and is parsed with orderEventDataSchema on read;
 * `type` repeats its discriminator so the column can be checked and filtered.
 */
export const orderEvent = pgTable(
  'order_event',
  {
    id: id(),
    merchantId: merchantId(),
    orderId: text('order_id').notNull(),
    type: text('type', { enum: ORDER_EVENT_TYPES }).notNull(),
    data: jsonb('data').notNull(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'order_event_order_fk',
      columns: [t.merchantId, t.orderId],
      foreignColumns: [order.merchantId, order.id],
    }).onDelete('cascade'),
    check('order_event_type_ck', oneOf(t.type, ORDER_EVENT_TYPES)),
    check('order_event_data_type_ck', sql`${t.data} ->> 'type' = ${t.type}`),
    index('order_event_order_idx').on(t.merchantId, t.orderId, t.createdAt.desc(), t.id),
    merchantIsolation('order_event_merchant_isolation', t.merchantId),
  ],
);

export type OrderEventRow = typeof orderEvent.$inferSelect;
