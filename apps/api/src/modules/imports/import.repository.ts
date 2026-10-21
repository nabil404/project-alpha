import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  FAILED_RESULTS,
  NOT_PRODUCT_RESULTS,
  type ImportAnywayStatus,
  type ImportPostFilter,
  type ImportPostResult,
  type ImportRunStatus,
} from '@app/shared';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import {
  product,
  productImport,
  productImportPost,
  productPost,
  productVariant,
  type ProductImportPostRow,
  type ProductImportRow,
} from '../database/schema/index';
import { liveVariant } from '../products/product-visibility';

export interface NewRunValues {
  since: string;
  until: string;
  startedBy: string | null;
}

/** What a post's handling adds to its run's counts. */
export interface RunCounts {
  postsRead?: number;
  drafts?: number;
  merged?: number;
  notProducts?: number;
  inCatalog?: number;
  alreadyImported?: number;
  failed?: number;
}

export type NewPostValues = Pick<
  typeof productImportPost.$inferInsert,
  | 'postId'
  | 'createdTime'
  | 'caption'
  | 'permalinkUrl'
  | 'photoCount'
  | 'result'
  | 'limitsApplied'
  | 'anywayStatus'
  | 'note'
  | 'matchedProductIds'
  | 'suggestedCategory'
  | 'productIds'
  | 'extracted'
>;

/** A product an import made, summed up for the summary's tabs. */
export interface ImportProductSummary {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  coverImageId: string | null;
  variantCount: number;
  needsPrice: boolean;
  needsStock: boolean;
}

const COUNT_COLUMNS = {
  postsRead: productImport.postsRead,
  drafts: productImport.drafts,
  merged: productImport.merged,
  notProducts: productImport.notProducts,
  inCatalog: productImport.inCatalog,
  alreadyImported: productImport.alreadyImported,
  failed: productImport.failed,
} as const;

/** The Skipped posts tab: no product, already in the catalog, or imported before. */
const SKIPPED_TAB: readonly ImportPostResult[] = [
  ...NOT_PRODUCT_RESULTS,
  'in_catalog',
  'already_imported',
];

/** Import runs and the posts they handled. Every method is scoped to one shop. */
@Injectable()
export class ImportRepository {
  /** Refused by PRODUCT_IMPORT_ACTIVE_UIDX while the shop has a queued, running or stopping run. */
  async insertRun(
    executor: Executor,
    { merchantId }: TenantScope,
    values: NewRunValues,
  ): Promise<ProductImportRow> {
    return one(
      await executor
        .insert(productImport)
        .values({ merchantId, source: 'facebook_posts', status: 'queued', ...values })
        .returning(),
      'product_import insert',
    );
  }

  async findRun(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<ProductImportRow | undefined> {
    const query = executor
      .select()
      .from(productImport)
      .where(and(eq(productImport.merchantId, merchantId), eq(productImport.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  /** Newest first. */
  listRuns(
    executor: Executor,
    { merchantId }: TenantScope,
    { offset, limit }: { offset: number; limit: number },
  ): Promise<ProductImportRow[]> {
    return executor
      .select()
      .from(productImport)
      .where(eq(productImport.merchantId, merchantId))
      .orderBy(desc(productImport.createdAt), desc(productImport.id))
      .limit(limit)
      .offset(offset);
  }

  async countRuns(executor: Executor, { merchantId }: TenantScope): Promise<number> {
    const [row] = await executor
      .select({ value: count() })
      .from(productImport)
      .where(eq(productImport.merchantId, merchantId));
    return Number(row?.value ?? 0);
  }

  async updateRun(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Partial<
      Pick<
        ProductImportRow,
        'status' | 'errorCode' | 'cursor' | 'postsTotal' | 'startedAt' | 'finishedAt'
      >
    >,
  ): Promise<void> {
    await executor
      .update(productImport)
      .set(values)
      .where(and(eq(productImport.merchantId, merchantId), eq(productImport.id, id)));
  }

  /**
   * Moves the run's counts by `delta` (negative to undo a skip that Import
   * anyway reversed) and sets or bumps the run of LLM failures. Returns the
   * new run of LLM failures.
   */
  async addCounts(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    delta: RunCounts,
    llmFailures: 'keep' | 'reset' | 'bump' = 'keep',
  ): Promise<number> {
    const set: Record<string, SQL> = {};
    for (const [key, value] of Object.entries(delta) as [keyof RunCounts, number][]) {
      if (value) set[key] = sql`greatest(${COUNT_COLUMNS[key]} + ${value}, 0)`;
    }
    if (llmFailures === 'reset') set.llmFailuresInRow = sql`0`;
    if (llmFailures === 'bump') set.llmFailuresInRow = sql`${productImport.llmFailuresInRow} + 1`;
    if (Object.keys(set).length === 0) return 0;
    const [row] = await executor
      .update(productImport)
      .set(set)
      .where(and(eq(productImport.merchantId, merchantId), eq(productImport.id, id)))
      .returning({ failures: productImport.llmFailuresInRow });
    return row?.failures ?? 0;
  }

  /** How many of each run's products are still drafts: its Left to review. */
  async leftToReview(
    executor: Executor,
    { merchantId }: TenantScope,
    importIds: string[],
  ): Promise<Map<string, number>> {
    if (importIds.length === 0) return new Map();
    const rows = await executor
      .select({
        importId: productImportPost.importId,
        drafts: sql<number>`count(distinct ${product.id})::int`,
      })
      .from(productImportPost)
      .innerJoin(
        product,
        and(
          eq(product.merchantId, productImportPost.merchantId),
          sql`${product.id} = any(${productImportPost.productIds})`,
        ),
      )
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          inArray(productImportPost.importId, importIds),
          eq(product.status, 'draft'),
        ),
      )
      .groupBy(productImportPost.importId);
    return new Map(rows.map((row) => [row.importId, row.drafts]));
  }

  /** The run's own row for a post, when this run already handled it. */
  async findPostInRun(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    postId: string,
  ): Promise<ProductImportPostRow | undefined> {
    const [row] = await executor
      .select()
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.importId, importId),
          eq(productImportPost.postId, postId),
        ),
      );
    return row;
  }

  async findPost(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    id: string,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<ProductImportPostRow | undefined> {
    const query = executor
      .select()
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.importId, importId),
          eq(productImportPost.id, id),
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  /**
   * Whether the post was imported before: a product link holds it (any
   * status), or another run handled it with any result but `failed`.
   * `graphId` is Graph's `<page id>_<post id>`; `keys` are the post's own ids
   * as product links store them. Answers the products it is linked to, or
   * that the earlier run made or matched, so the seller can see where it went;
   * null when it is new.
   */
  async importedBefore(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    graphId: string,
    keys: readonly string[],
  ): Promise<{ productIds: string[] } | null> {
    if (keys.length > 0) {
      const linked = await executor
        .select({ productId: productPost.productId })
        .from(productPost)
        .where(
          and(
            eq(productPost.merchantId, merchantId),
            or(inArray(productPost.postId, [...keys]), inArray(productPost.aliasId, [...keys])),
          ),
        );
      if (linked.length > 0) {
        return { productIds: [...new Set(linked.map((row) => row.productId))] };
      }
    }
    const [earlier] = await executor
      .select({
        productIds: productImportPost.productIds,
        matchedProductIds: productImportPost.matchedProductIds,
      })
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.postId, graphId),
          ne(productImportPost.importId, importId),
          notInArray(productImportPost.result, [...FAILED_RESULTS]),
        ),
      )
      .limit(1);
    return earlier
      ? { productIds: [...new Set([...earlier.productIds, ...earlier.matchedProductIds])] }
      : null;
  }

  /**
   * Writes the run's row for a post. A row the run already has is replaced:
   * that is a `failed` post read again on resume, or Import anyway.
   */
  async upsertPost(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    values: NewPostValues,
  ): Promise<ProductImportPostRow> {
    const { postId, ...changes } = values;
    return one(
      await executor
        .insert(productImportPost)
        .values({ merchantId, importId, ...values })
        .onConflictDoUpdate({
          target: [
            productImportPost.merchantId,
            productImportPost.importId,
            productImportPost.postId,
          ],
          set: { ...changes, updatedAt: new Date() },
        })
        .returning(),
      `product_import_post upsert ${postId}`,
    );
  }

  /** Records where Import anyway stands on a post, without touching its result. */
  async setAnywayStatus(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    id: string,
    status: ImportAnywayStatus | null,
  ): Promise<void> {
    await executor
      .update(productImportPost)
      .set({ anywayStatus: status, updatedAt: new Date() })
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.importId, importId),
          eq(productImportPost.id, id),
        ),
      );
  }

  /** The run's posts, latest handled first; `filter` picks a summary tab. */
  listPosts(
    executor: Executor,
    scope: TenantScope,
    importId: string,
    { filter, offset, limit }: { filter?: ImportPostFilter; offset: number; limit: number },
  ): Promise<ProductImportPostRow[]> {
    return executor
      .select()
      .from(productImportPost)
      .where(postConditions(executor, scope, importId, filter))
      .orderBy(desc(productImportPost.createdAt), desc(productImportPost.id))
      .limit(limit)
      .offset(offset);
  }

  async countPosts(
    executor: Executor,
    scope: TenantScope,
    importId: string,
    filter?: ImportPostFilter,
  ): Promise<number> {
    const [row] = await executor
      .select({ value: count() })
      .from(productImportPost)
      .where(postConditions(executor, scope, importId, filter));
    return Number(row?.value ?? 0);
  }

  /** The products these ids name that still exist, each summed up over its live variants. */
  async productSummaries(
    executor: Executor,
    { merchantId }: TenantScope,
    ids: string[],
  ): Promise<Map<string, ImportProductSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({
        id: product.id,
        name: product.name,
        status: product.status,
        coverImageId: product.coverImageId,
        variantCount: sql<number>`count(${productVariant.id})::int`,
        needsPrice: sql<boolean>`coalesce(bool_or(${productVariant.price} is null), false)`,
        needsStock: sql<boolean>`coalesce(bool_or(${productVariant.stock} is null), false)`,
      })
      .from(product)
      .leftJoin(
        productVariant,
        and(
          eq(productVariant.merchantId, product.merchantId),
          eq(productVariant.productId, product.id),
          liveVariant(),
        ),
      )
      .where(and(eq(product.merchantId, merchantId), inArray(product.id, [...new Set(ids)])))
      .groupBy(product.id);
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Whether one of the run's posts made or merged into this product. */
  async isRunProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
    productId: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: productImportPost.id })
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.importId, importId),
          sql`${productId} = any(${productImportPost.productIds})`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** The post that made a product, or the first one merged into it when none did. */
  async findProductSource(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
  ): Promise<ProductImportPostRow | undefined> {
    const [row] = await executor
      .select()
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          sql`${productId} = any(${productImportPost.productIds})`,
        ),
      )
      .orderBy(
        sql`${productImportPost.result} = 'draft' desc`,
        asc(productImportPost.createdAt),
        asc(productImportPost.id),
      )
      .limit(1);
    return row;
  }

  /** Every product of the shop, any status, by name: what a post's products are matched against. */
  namedProducts(
    executor: Executor,
    { merchantId }: TenantScope,
  ): Promise<{ id: string; name: string; aliases: string[] }[]> {
    return executor
      .select({ id: product.id, name: product.name, aliases: product.aliases })
      .from(product)
      .where(eq(product.merchantId, merchantId));
  }

  /** The drafts this run made so far, for merging reposts into them. */
  async runDraftIds(
    executor: Executor,
    { merchantId }: TenantScope,
    importId: string,
  ): Promise<string[]> {
    const rows = await executor
      .select({ ids: productImportPost.productIds })
      .from(productImportPost)
      .where(
        and(
          eq(productImportPost.merchantId, merchantId),
          eq(productImportPost.importId, importId),
          eq(productImportPost.result, 'draft'),
        ),
      );
    return [...new Set(rows.flatMap((row) => row.ids))];
  }
}

/**
 * The summary's tabs. Needs info and Ready list the posts that made drafts
 * still in draft, missing a price or priced throughout; stock is set on
 * activation, so it does not decide the tab.
 */
function postConditions(
  executor: Executor,
  { merchantId }: TenantScope,
  importId: string,
  filter: ImportPostFilter | undefined,
): SQL | undefined {
  const own = and(
    eq(productImportPost.merchantId, merchantId),
    eq(productImportPost.importId, importId),
  );
  if (!filter) return own;
  if (filter === 'skipped') return and(own, inArray(productImportPost.result, [...SKIPPED_TAB]));

  const unpriced = executor
    .select({ one: sql`1` })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.merchantId, product.merchantId),
        eq(productVariant.productId, product.id),
        liveVariant(),
        sql`${productVariant.price} is null`,
      ),
    );
  const draft = executor
    .select({ one: sql`1` })
    .from(product)
    .where(
      and(
        eq(product.merchantId, productImportPost.merchantId),
        sql`${product.id} = any(${productImportPost.productIds})`,
        eq(product.status, 'draft'),
        filter === 'needs_info' ? sql`exists ${unpriced}` : sql`not exists ${unpriced}`,
      ),
    );
  return and(own, eq(productImportPost.result, 'draft'), sql`exists ${draft}`);
}

/** The statuses a run is still going in. */
export const RUN_GOING: readonly ImportRunStatus[] = ['queued', 'running', 'stopping'];
