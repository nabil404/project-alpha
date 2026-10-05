import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { deliveryCharge } from '../database/schema/index';

export type DeliveryChargeRow = typeof deliveryCharge.$inferSelect;
export type DeliveryChargeValues = Pick<
  typeof deliveryCharge.$inferInsert,
  'areaName' | 'isFallback' | 'charge' | 'deliveryTime' | 'position'
>;

@Injectable()
export class DeliveryChargesRepository {
  /** The named areas as listed, then the fallback. */
  list(executor: Executor, { merchantId }: TenantScope): Promise<DeliveryChargeRow[]> {
    return executor
      .select()
      .from(deliveryCharge)
      .where(eq(deliveryCharge.merchantId, merchantId))
      .orderBy(
        asc(deliveryCharge.isFallback),
        asc(deliveryCharge.position),
        asc(deliveryCharge.id),
      );
  }

  async find(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<DeliveryChargeRow | undefined> {
    const [row] = await executor
      .select()
      .from(deliveryCharge)
      .where(and(eq(deliveryCharge.merchantId, merchantId), eq(deliveryCharge.id, id)));
    return row;
  }

  async findMany(
    executor: Executor,
    { merchantId }: TenantScope,
    ids: string[],
  ): Promise<DeliveryChargeRow[]> {
    if (ids.length === 0) return [];
    return executor
      .select()
      .from(deliveryCharge)
      .where(and(eq(deliveryCharge.merchantId, merchantId), inArray(deliveryCharge.id, ids)));
  }

  async insert(
    executor: Executor,
    { merchantId }: TenantScope,
    values: DeliveryChargeValues[],
  ): Promise<void> {
    if (values.length === 0) return;
    await executor.insert(deliveryCharge).values(values.map((value) => ({ merchantId, ...value })));
  }

  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: Partial<DeliveryChargeValues>,
  ): Promise<DeliveryChargeRow> {
    return one(
      await executor
        .update(deliveryCharge)
        .set(values)
        .where(and(eq(deliveryCharge.merchantId, merchantId), eq(deliveryCharge.id, id)))
        .returning(),
      'delivery_charge update',
    );
  }

  /**
   * Removes every named area not in `keepIds`; never the fallback. Their
   * product charges go with them (cascade); their orders are unlinked and
   * keep their snapshots.
   */
  async deleteNamedExcept(
    executor: Executor,
    { merchantId }: TenantScope,
    keepIds: string[],
  ): Promise<void> {
    await executor
      .delete(deliveryCharge)
      .where(
        and(
          eq(deliveryCharge.merchantId, merchantId),
          eq(deliveryCharge.isFallback, false),
          ...(keepIds.length > 0 ? [notInArray(deliveryCharge.id, keepIds)] : []),
        ),
      );
  }
}
