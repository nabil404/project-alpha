import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { LOW_STOCK_THRESHOLD, type ProductListFilter, type ProductStatus } from '@app/shared';
import type { Executor, TenantScope } from '../database/base.repository';
import { likePattern } from '../database/like-pattern';
import { one } from '../database/rows';
import { category, product, productCategory, productVariant } from '../database/schema/index';
import { generateSku } from './sku';
import { liveCategory } from '../categories/category-visibility';
import { liveVariant, sellableProduct } from './product-visibility';

export type ProductRow = typeof product.$inferSelect;
export type VariantRow = typeof productVariant.$inferSelect;

export interface NewProductValues {
  name: string;
  description: string | null;
  status: ProductStatus;
  aliases: string[];
  deliveryCharge: number;
}

export interface NewVariantValues {
  productId: string;
  /** Null makes it the default variant. */
  name: string | null;
  /** Already normalized; null generates one. */
  sku: string | null;
  price: number;
  stock: number;
  imageId: string | null;
}

/** A product's live variants summed up, as the Products page lists it. */
export interface ProductTotals {
  variantCount: number;
  priceMin: number;
  priceMax: number;
  stock: number;
  lowCount: number;
  outCount: number;
}

export interface ProductListRow {
  product: ProductRow;
  totals: ProductTotals;
}

export interface ProductListQuery {
  filter: ProductListFilter;
  q?: string;
  /** A product in any of these matches; empty matches nothing. */
  categoryIds?: string[];
  offset: number;
  limit: number;
}

/** Each generated SKU collides with odds of roughly 1 in 10^12; five tries is plenty. */
const SKU_ATTEMPTS = 5;

@Injectable()
export class ProductsRepository {
  async insertProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    values: NewProductValues,
  ): Promise<ProductRow> {
    return one(
      await executor
        .insert(product)
        .values({ merchantId, ...values })
        .returning(),
      'product insert',
    );
  }

  /** `lock` takes FOR UPDATE, serializing variant changes on this product. */
  async findProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<ProductRow | undefined> {
    const query = executor
      .select()
      .from(product)
      .where(and(eq(product.merchantId, merchantId), eq(product.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  /**
   * Every call bumps `revision`, the product's version on the wire, even with
   * no fields: category links and variants are part of the document too, and
   * their writers call this to mark the change.
   */
  async updateProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Partial<NewProductValues> & { coverImageId?: string | null },
  ): Promise<void> {
    await executor
      .update(product)
      .set({ ...values, revision: sql`${product.revision} + 1` })
      .where(and(eq(product.merchantId, merchantId), eq(product.id, id)));
  }

  /**
   * Leaves `revision` alone: the gallery is saved as it changes, not with the
   * edit page's document, so a photo upload must not make that page's save stale.
   */
  async setCoverImage(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    imageId: string | null,
  ): Promise<void> {
    await executor
      .update(product)
      .set({ coverImageId: imageId })
      .where(and(eq(product.merchantId, merchantId), eq(product.id, productId)));
  }

  /** False when there was no such product. Variants and links cascade. */
  async deleteProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<boolean> {
    const rows = await executor
      .delete(product)
      .where(and(eq(product.merchantId, merchantId), eq(product.id, id)))
      .returning({ id: product.id });
    return rows.length > 0;
  }

  async listSellable(executor: Executor, { merchantId }: TenantScope): Promise<ProductRow[]> {
    return executor
      .select()
      .from(product)
      .where(and(eq(product.merchantId, merchantId), sellableProduct()))
      .orderBy(asc(product.name));
  }

  /** Newest first. A product whose variants are all archived has no totals and is not listed. */
  async listPage(
    executor: Executor,
    scope: TenantScope,
    query: ProductListQuery,
  ): Promise<ProductListRow[]> {
    const totals = variantTotals(executor, scope);
    const rows = await executor
      .select({
        product,
        totals: {
          variantCount: totals.variantCount,
          priceMin: totals.priceMin,
          priceMax: totals.priceMax,
          stock: totals.stock,
          lowCount: totals.lowCount,
          outCount: totals.outCount,
        },
      })
      .from(product)
      .innerJoin(totals, eq(totals.productId, product.id))
      .where(listConditions(executor, scope, query, totals))
      .orderBy(desc(product.createdAt), desc(product.id))
      .limit(query.limit)
      .offset(query.offset);
    return rows;
  }

  /** How many products `listPage` would page through. */
  async countList(
    executor: Executor,
    scope: TenantScope,
    query: Omit<ProductListQuery, 'offset' | 'limit'>,
  ): Promise<number> {
    const totals = variantTotals(executor, scope);
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(product)
      .innerJoin(totals, eq(totals.productId, product.id))
      .where(listConditions(executor, scope, query, totals));
    return row?.count ?? 0;
  }

  /** One pass for every filter chip, with the same stock rules as the filters. */
  async counts(executor: Executor, scope: TenantScope): Promise<Record<ProductListFilter, number>> {
    const totals = variantTotals(executor, scope);
    const notArchived = sql`${product.status} <> 'archived'`;
    const count = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
    const [row] = await executor
      .select({
        all: count(notArchived),
        in_stock: count(sql`${notArchived} and ${stockCondition('in_stock', totals)}`),
        low_stock: count(sql`${notArchived} and ${stockCondition('low_stock', totals)}`),
        out_of_stock: count(sql`${notArchived} and ${stockCondition('out_of_stock', totals)}`),
        draft: count(sql`${product.status} = 'draft'`),
        archived: count(sql`${product.status} = 'archived'`),
      })
      .from(product)
      .innerJoin(totals, eq(totals.productId, product.id))
      .where(eq(product.merchantId, scope.merchantId));
    return {
      all: row?.all ?? 0,
      in_stock: row?.in_stock ?? 0,
      low_stock: row?.low_stock ?? 0,
      out_of_stock: row?.out_of_stock ?? 0,
      draft: row?.draft ?? 0,
      archived: row?.archived ?? 0,
    };
  }

  async liveVariants(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<VariantRow[]> {
    if (productIds.length === 0) return [];
    return executor
      .select()
      .from(productVariant)
      .where(
        and(
          eq(productVariant.merchantId, merchantId),
          inArray(productVariant.productId, productIds),
          liveVariant(),
        ),
      )
      .orderBy(asc(productVariant.createdAt), asc(productVariant.id));
  }

  /**
   * A seller's SKU inserts plainly, so a collision surfaces as a unique
   * violation for the service to map to SKU_TAKEN. A generated SKU inserts with
   * ON CONFLICT DO NOTHING on the live-SKU index instead: a violation would
   * abort the surrounding transaction and leave nothing to retry in.
   */
  async insertVariant(
    executor: Executor,
    { merchantId }: TenantScope,
    values: NewVariantValues,
  ): Promise<VariantRow> {
    const row = {
      merchantId,
      productId: values.productId,
      name: values.name,
      price: values.price,
      stock: values.stock,
      imageId: values.imageId,
      isDefault: values.name === null,
    };

    if (values.sku !== null) {
      return one(
        await executor
          .insert(productVariant)
          .values({ ...row, sku: values.sku })
          .returning(),
        'variant insert',
      );
    }

    for (let attempt = 0; attempt < SKU_ATTEMPTS; attempt++) {
      const [inserted] = await executor
        .insert(productVariant)
        .values({ ...row, sku: generateSku() })
        .onConflictDoNothing({
          target: [productVariant.merchantId, productVariant.sku],
          where: sql`archived_at is null`,
        })
        .returning();
      if (inserted) return inserted;
    }
    throw new Error(`No free SKU after ${SKU_ATTEMPTS} generated attempts`);
  }

  /** Setting `name` also sets `is_default` to match: the default variant is exactly the unnamed one. */
  async updateVariant(
    executor: Executor,
    { merchantId }: TenantScope,
    variantId: string,
    values: {
      name?: string | null;
      sku?: string;
      price?: number;
      stock?: number;
      imageId?: string | null;
    },
  ): Promise<void> {
    const set = values.name === undefined ? values : { ...values, isDefault: values.name === null };
    await executor
      .update(productVariant)
      .set(set)
      .where(and(eq(productVariant.merchantId, merchantId), eq(productVariant.id, variantId)));
  }

  async archiveVariant(
    executor: Executor,
    { merchantId }: TenantScope,
    variantId: string,
  ): Promise<void> {
    await executor
      .update(productVariant)
      .set({ archivedAt: new Date() })
      .where(and(eq(productVariant.merchantId, merchantId), eq(productVariant.id, variantId)));
  }

  /** Replaces the product's links with exactly `categoryIds` (already deduplicated). */
  async setCategories(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    categoryIds: string[],
  ): Promise<void> {
    await executor
      .delete(productCategory)
      .where(
        and(eq(productCategory.merchantId, merchantId), eq(productCategory.productId, productId)),
      );
    if (categoryIds.length > 0) {
      await executor
        .insert(productCategory)
        .values(categoryIds.map((categoryId) => ({ merchantId, productId, categoryId })));
    }
  }

  /**
   * Live category ids per product, ordered by category name. Deleting a
   * category already removes its links; the join keeps the visibility rule
   * local rather than trusting that.
   */
  async categoryIdsByProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<Map<string, string[]>> {
    const byProduct = new Map<string, string[]>();
    if (productIds.length === 0) return byProduct;

    const rows = await executor
      .select({ productId: productCategory.productId, categoryId: productCategory.categoryId })
      .from(productCategory)
      .innerJoin(
        category,
        and(
          eq(category.merchantId, productCategory.merchantId),
          eq(category.id, productCategory.categoryId),
        ),
      )
      .where(
        and(
          eq(productCategory.merchantId, merchantId),
          inArray(productCategory.productId, productIds),
          liveCategory(),
        ),
      )
      .orderBy(asc(category.name));

    for (const row of rows) {
      byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row.categoryId]);
    }
    return byProduct;
  }
}

/** Per product: its live variants counted, priced and summed. */
function variantTotals(executor: Executor, { merchantId }: TenantScope) {
  const low = sql`${productVariant.stock} > 0 and ${productVariant.stock} <= ${LOW_STOCK_THRESHOLD}`;
  return executor
    .select({
      productId: productVariant.productId,
      variantCount: sql<number>`count(*)::int`.as('variant_count'),
      priceMin: sql<number>`min(${productVariant.price})::int`.as('price_min'),
      priceMax: sql<number>`max(${productVariant.price})::int`.as('price_max'),
      stock: sql<number>`coalesce(sum(${productVariant.stock}), 0)::int`.as('stock_total'),
      lowCount: sql<number>`(count(*) filter (where ${low}))::int`.as('low_count'),
      outCount: sql<number>`(count(*) filter (where ${productVariant.stock} = 0))::int`.as(
        'out_count',
      ),
    })
    .from(productVariant)
    .where(and(eq(productVariant.merchantId, merchantId), liveVariant()))
    .groupBy(productVariant.productId)
    .as('variant_totals');
}

type VariantTotals = ReturnType<typeof variantTotals>;

/** Out: nothing left. Low: something left, but some variant is low or out. In: every variant above the threshold. */
function stockCondition(
  level: 'in_stock' | 'low_stock' | 'out_of_stock',
  totals: VariantTotals,
): SQL {
  const flagged = sql`${totals.lowCount} + ${totals.outCount}`;
  switch (level) {
    case 'out_of_stock':
      return sql`${totals.stock} = 0`;
    case 'low_stock':
      return sql`${totals.stock} > 0 and ${flagged} > 0`;
    case 'in_stock':
      return sql`${flagged} = 0`;
  }
}

function listConditions(
  executor: Executor,
  { merchantId }: TenantScope,
  { filter, q, categoryIds }: Omit<ProductListQuery, 'offset' | 'limit'>,
  totals: VariantTotals,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(product.merchantId, merchantId)];

  if (filter === 'draft' || filter === 'archived') {
    conditions.push(eq(product.status, filter));
  } else {
    conditions.push(ne(product.status, 'archived'));
    if (filter !== 'all') conditions.push(stockCondition(filter, totals));
  }

  if (q) {
    const pattern = likePattern(q);
    conditions.push(
      or(
        ilike(product.name, pattern),
        sql`exists (select 1 from unnest(${product.aliases}) as alias where alias ilike ${pattern})`,
        exists(
          executor
            .select({ one: sql`1` })
            .from(productVariant)
            .where(
              and(
                eq(productVariant.merchantId, merchantId),
                eq(productVariant.productId, product.id),
                liveVariant(),
                ilike(productVariant.sku, pattern),
              ),
            ),
        ),
      ),
    );
  }

  if (categoryIds !== undefined) {
    conditions.push(
      categoryIds.length === 0
        ? sql`false`
        : exists(
            executor
              .select({ one: sql`1` })
              .from(productCategory)
              .where(
                and(
                  eq(productCategory.merchantId, merchantId),
                  eq(productCategory.productId, product.id),
                  inArray(productCategory.categoryId, categoryIds),
                ),
              ),
          ),
    );
  }

  return and(...conditions);
}
