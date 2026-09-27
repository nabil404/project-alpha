import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { ProductStatus } from '@app/shared';
import type { Executor, TenantScope } from '../../database/base.repository.js';
import { one } from '../../database/rows.js';
import { category, product, productCategory, productVariant } from '../../database/schema/index.js';
import { generateSku } from './sku.js';
import { liveCategory } from '../categories/category-visibility.js';
import { liveVariant, sellableProduct } from './product-visibility.js';

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

  async updateProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Partial<NewProductValues>,
  ): Promise<void> {
    await executor
      .update(product)
      .set(values)
      .where(and(eq(product.merchantId, merchantId), eq(product.id, id)));
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
    values: { name?: string | null; sku?: string; price?: number; stock?: number },
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
