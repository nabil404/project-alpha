import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { product, productVariant } from '../database/schema/index';

/** A variant as an order line is written from: the snapshot fields plus what decides if it can be sold. */
export interface OrderableVariant {
  id: string;
  productId: string;
  productName: string;
  /** Null for a product's single, unnamed variant. */
  variantName: string | null;
  sku: string;
  price: number;
  stock: number;
  /** Not archived, and neither is its product. */
  live: boolean;
}

/**
 * The orders side of the catalog: reading variants to snapshot onto lines,
 * and moving stock when an order takes or gives it back. Every write here
 * bumps the product's revision, as the domain requires, so an edit page open
 * on the product sees its stock changed under it.
 */
@Injectable()
export class OrderCatalogRepository {
  async findVariants(
    executor: Executor,
    { merchantId }: TenantScope,
    ids: string[],
  ): Promise<Map<string, OrderableVariant>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({
        id: productVariant.id,
        productId: productVariant.productId,
        productName: product.name,
        variantName: productVariant.name,
        sku: productVariant.sku,
        price: productVariant.price,
        stock: productVariant.stock,
        live: sql<boolean>`${productVariant.archivedAt} is null and ${product.status} <> 'archived'`,
      })
      .from(productVariant)
      .innerJoin(
        product,
        and(
          eq(product.merchantId, productVariant.merchantId),
          eq(product.id, productVariant.productId),
        ),
      )
      .where(and(eq(productVariant.merchantId, merchantId), inArray(productVariant.id, ids)));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Locks the products, in id order, before their variants are touched. The
   * product edit page's save locks the product first too, so the two writers
   * queue on the same row instead of deadlocking on each other's variants.
   * Also bumps each product's revision.
   */
  async lockAndBumpProducts(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<void> {
    if (productIds.length === 0) return;
    const mine = and(eq(product.merchantId, merchantId), inArray(product.id, productIds));
    await executor
      .select({ id: product.id })
      .from(product)
      .where(mine)
      .orderBy(asc(product.id))
      .for('update');
    await executor
      .update(product)
      .set({ revision: sql`${product.revision} + 1` })
      .where(mine);
  }

  /**
   * Adds `change` (negative to take) to the variant's stock. Null when taking
   * would go below zero, with nothing changed; otherwise the new stock.
   */
  async adjustStock(
    executor: Executor,
    { merchantId }: TenantScope,
    variantId: string,
    change: number,
  ): Promise<number | null> {
    const [row] = await executor
      .update(productVariant)
      .set({ stock: sql`${productVariant.stock} + ${change}` })
      .where(
        and(
          eq(productVariant.merchantId, merchantId),
          eq(productVariant.id, variantId),
          sql`${productVariant.stock} + ${change} >= 0`,
        ),
      )
      .returning({ stock: productVariant.stock });
    return row?.stock ?? null;
  }
}
