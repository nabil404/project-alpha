import { integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { id, merchantId, merchantIsolation } from './columns';

/**
 * A click-to-Messenger ad seen in a referral, and the product it sells once
 * the seller maps it. `product_id` is null until then: the same row is the
 * "needs a product" list.
 *
 * The composite foreign key (merchant_id, product_id) to product is not
 * declared here: it is `ON DELETE SET NULL (product_id)`, which drizzle-kit
 * cannot express, so migration 0039 adds it (as 0006, 0014 and 0027 did for
 * theirs), along with FORCE ROW LEVEL SECURITY and the last-seen index.
 */
export const adProduct = pgTable(
  'ad_product',
  {
    id: id(),
    merchantId: merchantId(),
    pageId: text('page_id').notNull(),
    adId: text('ad_id').notNull(),
    productId: text('product_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    chatCount: integer('chat_count').notNull().default(0),
  },
  (t) => [
    unique('ad_product_merchant_ad_uq').on(t.merchantId, t.adId),
    merchantIsolation('ad_product_merchant_isolation', t.merchantId),
  ],
);

export type AdProductRow = typeof adProduct.$inferSelect;
