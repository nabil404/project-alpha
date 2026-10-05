import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { deliveryCharge, productDeliveryCharge } from '../database/schema/index';

export type ProductDeliveryChargeRow = typeof productDeliveryCharge.$inferSelect;
export interface ProductDeliveryChargeValue {
  deliveryChargeId: string;
  charge: number;
}

/** A product's own charges per area; areas without one cost the shop charge. */
@Injectable()
export class ProductDeliveryRepository {
  /** These products' own charges, each list in the order the shop lists its areas, everywhere else last. */
  async listForProducts(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<(ProductDeliveryChargeValue & { productId: string })[]> {
    if (productIds.length === 0) return [];
    return executor
      .select({
        productId: productDeliveryCharge.productId,
        deliveryChargeId: productDeliveryCharge.deliveryChargeId,
        charge: productDeliveryCharge.charge,
      })
      .from(productDeliveryCharge)
      .innerJoin(
        deliveryCharge,
        and(
          eq(deliveryCharge.merchantId, productDeliveryCharge.merchantId),
          eq(deliveryCharge.id, productDeliveryCharge.deliveryChargeId),
        ),
      )
      .where(
        and(
          eq(productDeliveryCharge.merchantId, merchantId),
          inArray(productDeliveryCharge.productId, productIds),
        ),
      )
      .orderBy(asc(deliveryCharge.isFallback), asc(deliveryCharge.position));
  }

  async replace(
    executor: Executor,
    { merchantId }: TenantScope,
    productId: string,
    rows: ProductDeliveryChargeValue[],
  ): Promise<void> {
    await executor
      .delete(productDeliveryCharge)
      .where(
        and(
          eq(productDeliveryCharge.merchantId, merchantId),
          eq(productDeliveryCharge.productId, productId),
        ),
      );
    if (rows.length > 0) {
      await executor
        .insert(productDeliveryCharge)
        .values(rows.map((row) => ({ merchantId, productId, ...row })));
    }
  }

  /** Each listed product's own charge for one area, for those that set one. */
  async forProducts(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
    deliveryChargeId: string,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ productId: productDeliveryCharge.productId, charge: productDeliveryCharge.charge })
      .from(productDeliveryCharge)
      .where(
        and(
          eq(productDeliveryCharge.merchantId, merchantId),
          eq(productDeliveryCharge.deliveryChargeId, deliveryChargeId),
          inArray(productDeliveryCharge.productId, productIds),
        ),
      );
    return new Map(rows.map((row) => [row.productId, row.charge]));
  }
}
