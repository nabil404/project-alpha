import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { product } from './catalog';
import { createdAt, id, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';

/** Literal copy of @app/shared's productPostStatuses. */
const PRODUCT_POST_STATUSES = ['linked', 'suggested'] as const;

/**
 * A Facebook post (or ad post) and the product it sells. `linked` rows are
 * the seller's own and resolve a shared post with no LLM call; `suggested`
 * rows are written by the assistant after a customer shared the post and its
 * caption named the product, and wait for the seller to accept them.
 *
 * Facebook names one post two ways: a number (`10161…`, in Graph ids and old
 * links) and a `pfbid…` id (in newer links). `post_id` is the one we were
 * given first, `alias_id` the other when we learn it; a shared link matches
 * either. Deleting the product deletes its links.
 */
export const productPost = pgTable(
  'product_post',
  {
    id: id(),
    merchantId: merchantId(),
    productId: text('product_id').notNull(),
    postId: text('post_id').notNull(),
    aliasId: text('alias_id'),
    url: text('url'),
    caption: text('caption'),
    status: text('status', { enum: PRODUCT_POST_STATUSES }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_post_merchant_post_uq').on(t.merchantId, t.postId),
    index('product_post_merchant_alias_idx').on(t.merchantId, t.aliasId),
    index('product_post_merchant_product_idx').on(t.merchantId, t.productId),
    foreignKey({
      name: 'product_post_product_fk',
      columns: [t.merchantId, t.productId],
      foreignColumns: [product.merchantId, product.id],
    }).onDelete('cascade'),
    check('product_post_status_ck', oneOf(t.status, PRODUCT_POST_STATUSES)),
    merchantIsolation('product_post_merchant_isolation', t.merchantId),
  ],
);

export type ProductPostRow = typeof productPost.$inferSelect;
