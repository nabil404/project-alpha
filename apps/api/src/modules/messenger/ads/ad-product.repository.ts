import { Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { ProductStatus } from '@app/shared';
import type { Executor, TenantScope } from '../../database/base.repository';
import { adProduct, product, type AdProductRow } from '../../database/schema/index';

export interface AdProductListRow extends AdProductRow {
  productName: string | null;
  productStatus: ProductStatus | null;
}

/** Ads seen in referrals and the product each sells. Every method is scoped to one shop. */
@Injectable()
export class AdProductRepository {
  /** Insert, or bump last_seen_at and chat_count; the mapped product id, or null while unmapped. */
  async recordSeen(
    executor: Executor,
    { merchantId }: TenantScope,
    { pageId, adId, at }: { pageId: string; adId: string; at: Date },
  ): Promise<string | null> {
    const [row] = await executor
      .insert(adProduct)
      .values({ merchantId, pageId, adId, firstSeenAt: at, lastSeenAt: at, chatCount: 1 })
      .onConflictDoUpdate({
        target: [adProduct.merchantId, adProduct.adId],
        set: {
          pageId,
          lastSeenAt: sql`greatest(${adProduct.lastSeenAt}, excluded.last_seen_at)`,
          chatCount: sql`${adProduct.chatCount} + 1`,
        },
      })
      .returning({ productId: adProduct.productId });
    return row?.productId ?? null;
  }

  list(executor: Executor, scope: TenantScope): Promise<AdProductListRow[]> {
    return this.select(executor, scope).orderBy(desc(adProduct.lastSeenAt), adProduct.id);
  }

  async find(executor: Executor, scope: TenantScope, id: string): Promise<AdProductListRow | null> {
    const [row] = await this.select(executor, scope, id);
    return row ?? null;
  }

  async setProduct(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    productId: string | null,
  ): Promise<boolean> {
    const rows = await executor
      .update(adProduct)
      .set({ productId })
      .where(and(eq(adProduct.merchantId, merchantId), eq(adProduct.id, id)))
      .returning({ id: adProduct.id });
    return rows.length > 0;
  }

  private select(executor: Executor, { merchantId }: TenantScope, id?: string) {
    return executor
      .select({
        ...getTableColumns(adProduct),
        productName: product.name,
        productStatus: product.status,
      })
      .from(adProduct)
      .leftJoin(
        product,
        and(eq(product.merchantId, adProduct.merchantId), eq(product.id, adProduct.productId)),
      )
      .where(
        id === undefined
          ? eq(adProduct.merchantId, merchantId)
          : and(eq(adProduct.merchantId, merchantId), eq(adProduct.id, id)),
      );
  }
}
