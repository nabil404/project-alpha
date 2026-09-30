import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { category, productCategory } from '../database/schema/index';
import { liveCategory } from './category-visibility';

export type CategoryRow = typeof category.$inferSelect;

/** Bounds the recursive walks; a valid tree stops at CATEGORY_MAX_DEPTH long before this. */
const MAX_WALK = 16;

@Injectable()
export class CategoriesRepository {
  /**
   * Serializes this merchant's tree writes until the transaction ends. Without
   * it, "A under B" and "B under A" each pass the cycle check against the
   * other's pre-move snapshot and both commit.
   */
  async lockTree(executor: Executor, { merchantId }: TenantScope): Promise<void> {
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

  /** `id` followed by its ancestors, nearest first. Its length is the depth of `id`; a root is 1. */
  async chainToRoot(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      with recursive chain (id, parent_id, hops) as (
        select id, parent_id, 0
        from category
        where merchant_id = ${merchantId} and id = ${id}
        union all
        select c.id, c.parent_id, chain.hops + 1
        from category c
        join chain on c.id = chain.parent_id
        where c.merchant_id = ${merchantId} and chain.hops < ${MAX_WALK}
      )
      select id from chain order by hops
    `);
    return result.rows.map((row) => row.id);
  }

  /** Levels in the live subtree rooted at `id`: 1 for a leaf. */
  async subtreeHeight(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<number> {
    const result = await executor.execute<{ height: number | null }>(sql`
      with recursive subtree (id, level) as (
        select id, 1
        from category
        where merchant_id = ${merchantId} and id = ${id}
        union all
        select c.id, subtree.level + 1
        from category c
        join subtree on c.parent_id = subtree.id
        where c.merchant_id = ${merchantId} and c.deleted_at is null and subtree.level < ${MAX_WALK}
      )
      select max(level)::int as height from subtree
    `);
    return result.rows[0]?.height ?? 0;
  }

  /** `id` and every live category under it; empty when `id` itself is not live. */
  async liveSubtreeIds(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      with recursive subtree (id, level) as (
        select id, 1
        from category
        where merchant_id = ${merchantId} and id = ${id} and deleted_at is null
        union all
        select c.id, subtree.level + 1
        from category c
        join subtree on c.parent_id = subtree.id
        where c.merchant_id = ${merchantId} and c.deleted_at is null and subtree.level < ${MAX_WALK}
      )
      select id from subtree
    `);
    return result.rows.map((row) => row.id);
  }

  async hasLiveChildren(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.merchantId, merchantId), eq(category.parentId, id), liveCategory()))
      .limit(1);
    return row !== undefined;
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { name: string; parentId: string | null },
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
   * `undefined` when the row lost a race to a concurrent delete: a rename-only
   * update takes no tree lock, so its UPDATE can wait on the row lock behind a
   * `remove`, then re-check `deleted_at IS NULL` and match nothing. The caller
   * maps that to `CATEGORY_NOT_FOUND`.
   */
  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: { name?: string; parentId?: string | null },
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
