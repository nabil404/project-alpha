import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { category, productCategory } from '../database/schema/index';
import { liveCategory } from './category-visibility';

export type CategoryRow = typeof category.$inferSelect;

@Injectable()
export class CategoriesRepository {
  /**
   * Serializes this merchant's category deletes and product links until the
   * transaction ends, so a product cannot be linked to a category that is
   * being deleted.
   */
  async lockCategories(executor: Executor, { merchantId }: TenantScope): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`category:${merchantId}`}, 0))`,
    );
  }

  async findLive(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<CategoryRow | undefined> {
    const [row] = await executor
      .select()
      .from(category)
      .where(and(eq(category.merchantId, merchantId), eq(category.id, id), liveCategory()));
    return row;
  }

  async listLive(executor: Executor, { merchantId }: TenantScope): Promise<CategoryRow[]> {
    return executor
      .select()
      .from(category)
      .where(and(eq(category.merchantId, merchantId), liveCategory()))
      .orderBy(asc(category.name));
  }

  async countLive(executor: Executor, { merchantId }: TenantScope, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(category)
      .where(and(eq(category.merchantId, merchantId), inArray(category.id, ids), liveCategory()));
    return row?.count ?? 0;
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { name: string },
  ): Promise<CategoryRow> {
    return one(
      await executor
        .insert(category)
        .values({ merchantId, ...values })
        .returning(),
      'category insert',
    );
  }

  /**
   * `undefined` when the row lost a race to a concurrent delete: a rename
   * takes no lock, so its UPDATE can wait on the row lock behind a
   * `remove`, then re-check `deleted_at IS NULL` and match nothing. The caller
   * maps that to `CATEGORY_NOT_FOUND`.
   */
  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: { name: string },
  ): Promise<CategoryRow | undefined> {
    const [row] = await executor
      .update(category)
      .set(values)
      .where(and(eq(category.merchantId, merchantId), eq(category.id, id), liveCategory()))
      .returning();
    return row;
  }

  /** Soft-deletes and unlinks, so no junction join can reach a deleted category. */
  async softDelete(executor: Executor, { merchantId }: TenantScope, id: string): Promise<void> {
    await executor
      .delete(productCategory)
      .where(and(eq(productCategory.merchantId, merchantId), eq(productCategory.categoryId, id)));
    await executor
      .update(category)
      .set({ deletedAt: new Date() })
      .where(and(eq(category.merchantId, merchantId), eq(category.id, id)));
  }
}
