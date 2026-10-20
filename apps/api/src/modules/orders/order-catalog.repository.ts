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
  /** `stock - reserved`: what a new order or a confirm can still take. */
  available: number;
  /** Not archived, and neither is its product. */
  live: boolean;
  /** The product is active: still in the catalog the assistant sells from. */
  productActive: boolean;
}

/**
 * The orders side of the catalog: reading variants to snapshot onto lines,
 * and moving stock and reservations as orders are drafted, confirmed,
 * cancelled or returned. Every write here bumps the product's revision, as the
 * domain requires, so an edit page open on the product sees its stock changed
 * under it.
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
        // A draft's variant may have no price or stock yet; it is not live until it has both.
        price: sql<number>`coalesce(${productVariant.price}, 0)`,
        available: sql<number>`coalesce(${productVariant.stock}, 0) - ${productVariant.reserved}`,
        live: sql<boolean>`${productVariant.archivedAt} is null and ${product.status} <> 'archived' and ${productVariant.price} is not null and ${productVariant.stock} is not null`,
        productActive: sql<boolean>`${product.status} = 'active'`,
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
   * Adds `stock` and `reserved` to the variant's counts together. Null, with
   * nothing changed, when that would leave less than nothing available or a
   * negative reservation, or the variant has no stock set; otherwise the new
   * counts.
   */
  async adjustStock(
    executor: Executor,
    { merchantId }: TenantScope,
    { variantId, stock, reserved }: { variantId: string; stock: number; reserved: number },
  ): Promise<{ stock: number; reserved: number } | null> {
    const [row] = await executor
      .update(productVariant)
      .set({
        stock: sql`${productVariant.stock} + ${stock}`,
        reserved: sql`${productVariant.reserved} + ${reserved}`,
      })
      .where(
        and(
          eq(productVariant.merchantId, merchantId),
          eq(productVariant.id, variantId),
          sql`(${productVariant.stock} + ${stock}) - (${productVariant.reserved} + ${reserved}) >= 0`,
          sql`${productVariant.reserved} + ${reserved} >= 0`,
        ),
      )
      // The condition above is null, and so matches nothing, for an empty stock.
      .returning({
        stock: sql<number>`${productVariant.stock}`,
        reserved: productVariant.reserved,
      });
    return row ?? null;
  }
}
