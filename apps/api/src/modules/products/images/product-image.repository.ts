import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import { productImage, type ProductImageRow } from '../../database/schema/index';

export type NewProductImage = Pick<
  typeof productImage.$inferInsert,
  'id' | 'productId' | 'storageKey' | 'position' | 'width' | 'height' | 'byteSize'
>;

/**
 * Rows only; objects in storage are the service's business. Locking the
 * product row, which serializes gallery changes, is ProductsRepository's.
 */
@Injectable()
export class ProductImageRepository {
  /** Ordered by product, then cover first. */
  async listForProducts(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<ProductImageRow[]> {
    if (productIds.length === 0) return [];
    return executor
      .select()
      .from(productImage)
      .where(
        and(eq(productImage.merchantId, merchantId), inArray(productImage.productId, productIds)),
      )
      .orderBy(
        asc(productImage.productId),
        asc(productImage.position),
        asc(productImage.createdAt),
      );
  }

  async count(executor: Executor, { merchantId }: TenantScope, productId: string): Promise<number> {
    const [row] = await executor
      .select({ value: count() })
      .from(productImage)
      .where(and(eq(productImage.merchantId, merchantId), eq(productImage.productId, productId)));
    return Number(row?.value ?? 0);
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: NewProductImage,
  ): Promise<ProductImageRow> {
    return one(
      await executor
        .insert(productImage)
        .values({ ...values, merchantId })
        .returning(),
      'product image insert',
    );
  }

  /** Deletes one image and returns it, or null when it is not on this merchant's product. */
  async delete(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    imageId: string,
  ): Promise<ProductImageRow | null> {
    const [row] = await executor
      .delete(productImage)
      .where(
        and(
          eq(productImage.merchantId, merchantId),
          eq(productImage.productId, productId),
          eq(productImage.id, imageId),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** position = index for each id. Callers pass the product's complete id list. */
  async setPositions(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    orderedIds: string[],
  ): Promise<void> {
    for (const [position, id] of orderedIds.entries()) {
      await executor
        .update(productImage)
        .set({ position })
        .where(
          and(
            eq(productImage.merchantId, merchantId),
            eq(productImage.productId, productId),
            eq(productImage.id, id),
          ),
        );
    }
  }

  /** Which of these image ids still have a row. The orphan sweep's lookup. */
  async existingIds(
    executor: Executor,
    { merchantId }: TenantScope,
    imageIds: string[],
  ): Promise<Set<string>> {
    if (imageIds.length === 0) return new Set();
    const rows = await executor
      .select({ id: productImage.id })
      .from(productImage)
      .where(and(eq(productImage.merchantId, merchantId), inArray(productImage.id, imageIds)));
    return new Set(rows.map((row) => row.id));
  }
}
