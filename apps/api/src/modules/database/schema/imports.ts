import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { id, instant, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';

/** Literal copies of @app/shared's import enums (drizzle-kit loads this file on its own); import.repository.spec keeps them equal. */
export const IMPORT_SOURCE_VALUES = ['facebook_posts'] as const;
export const IMPORT_STATUS_VALUES = [
  'queued',
  'running',
  'stopping',
  'stopped',
  'finished',
  'failed',
] as const;
export const IMPORT_POST_RESULT_VALUES = [
  'draft',
  'merged',
  'not_a_product',
  'no_caption_or_photo',
  'no_named_product',
  'in_catalog',
  'already_imported',
  'llm_failed',
  'photo_unreadable',
  'write_failed',
] as const;
export const IMPORT_ANYWAY_STATUS_VALUES = ['queued', 'no_product', 'failed'] as const;

/** The partial unique index that allows one queued, running or stopping run per shop. */
export const PRODUCT_IMPORT_ACTIVE_UIDX = 'product_import_merchant_active_uidx';

/**
 * One import run: the connected Page's posts between two shop-local dates,
 * read one at a time into draft products. The counts are updated after each
 * post; `cursor` is Graph's `after` cursor for the page being read, so a
 * resumed run goes on from there.
 */
export const productImport = pgTable(
  'product_import',
  {
    id: id(),
    merchantId: merchantId(),
    source: text('source', { enum: IMPORT_SOURCE_VALUES }).notNull(),
    since: date('since', { mode: 'string' }).notNull(),
    until: date('until', { mode: 'string' }).notNull(),
    status: text('status', { enum: IMPORT_STATUS_VALUES }).notNull(),
    /** An ErrorCode, set exactly when the run failed. */
    errorCode: text('error_code'),
    /** Null once that person's account is deleted. */
    startedBy: text('started_by').references(() => user.id, { onDelete: 'set null' }),
    cursor: text('cursor'),
    /** Unknown until the last page is read. */
    postsTotal: integer('posts_total'),
    postsRead: integer('posts_read').notNull().default(0),
    drafts: integer('drafts').notNull().default(0),
    merged: integer('merged').notNull().default(0),
    notProducts: integer('not_products').notNull().default(0),
    inCatalog: integer('in_catalog').notNull().default(0),
    alreadyImported: integer('already_imported').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** Five in a row fail the run; any other outcome resets it. */
    llmFailuresInRow: integer('llm_failures_in_row').notNull().default(0),
    createdAt: instant('created_at').defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_import_merchant_id_uq').on(t.merchantId, t.id),
    check('product_import_source_ck', oneOf(t.source, IMPORT_SOURCE_VALUES)),
    check('product_import_status_ck', oneOf(t.status, IMPORT_STATUS_VALUES)),
    check('product_import_range_ck', sql`${t.since} <= ${t.until}`),
    uniqueIndex(PRODUCT_IMPORT_ACTIVE_UIDX)
      .on(t.merchantId)
      .where(sql`${t.status} in ('queued', 'running', 'stopping')`),
    index('product_import_merchant_created_idx').on(t.merchantId, t.createdAt),
    merchantIsolation('product_import_merchant_isolation', t.merchantId),
  ],
);

export type ProductImportRow = typeof productImport.$inferSelect;

/**
 * One post a run handled and what became of it. A later run skips a post any
 * earlier run handled with a result other than `failed`, so its row outlives
 * the drafts it made. `extracted` is the checked LLM output, kept so Import
 * anyway on an `in_catalog` post needs no second call; `product_ids` are the
 * drafts it made or merged into, `matched_product_ids` the shop's products it
 * repeated. Neither array is a foreign key: a deleted product leaves its id.
 */
export const productImportPost = pgTable(
  'product_import_post',
  {
    id: id(),
    merchantId: merchantId(),
    importId: text('import_id').notNull(),
    /** Graph's `<page id>_<post id>`. */
    postId: text('post_id').notNull(),
    createdTime: timestamp('created_time', { withTimezone: true }),
    caption: text('caption'),
    permalinkUrl: text('permalink_url'),
    photoCount: integer('photo_count').notNull().default(0),
    result: text('result', { enum: IMPORT_POST_RESULT_VALUES }).notNull(),
    /** The reader's own words for a `not_a_product` post. */
    note: text('note'),
    limitsApplied: boolean('limits_applied').notNull().default(false),
    /** The last Import anyway on the post, until it makes drafts. */
    anywayStatus: text('anyway_status', { enum: IMPORT_ANYWAY_STATUS_VALUES }),
    matchedProductIds: text('matched_product_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    suggestedCategory: text('suggested_category'),
    productIds: text('product_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Parsed with postProductsSchema on read. */
    extracted: jsonb('extracted').$type<unknown>(),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_import_post_merchant_import_post_uq').on(t.merchantId, t.importId, t.postId),
    foreignKey({
      name: 'product_import_post_import_fk',
      columns: [t.merchantId, t.importId],
      foreignColumns: [productImport.merchantId, productImport.id],
    }).onDelete('cascade'),
    check('product_import_post_result_ck', oneOf(t.result, IMPORT_POST_RESULT_VALUES)),
    check(
      'product_import_post_anyway_status_ck',
      oneOf(t.anywayStatus, IMPORT_ANYWAY_STATUS_VALUES),
    ),
    check('product_import_post_photo_count_ck', sql`${t.photoCount} >= 0`),
    index('product_import_post_merchant_post_idx').on(t.merchantId, t.postId),
    index('product_import_post_merchant_import_created_idx').on(
      t.merchantId,
      t.importId,
      t.createdAt,
    ),
    merchantIsolation('product_import_post_merchant_isolation', t.merchantId),
  ],
);

export type ProductImportPostRow = typeof productImportPost.$inferSelect;
