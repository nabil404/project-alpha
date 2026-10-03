import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { merchantSettings, order, product, productVariant } from '../database/schema/index';

export type MerchantSettingsRow = typeof merchantSettings.$inferSelect;
export type MerchantSettingsValues = Omit<
  typeof merchantSettings.$inferInsert,
  'merchantId' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class MerchantSettingsRepository {
  async find(
    executor: Executor,
    { merchantId }: TenantScope,
  ): Promise<MerchantSettingsRow | undefined> {
    const [row] = await executor
      .select()
      .from(merchantSettings)
      .where(eq(merchantSettings.merchantId, merchantId));
    return row;
  }

  /**
   * The shop's row, created from `defaults` if it has none, locked until the
   * transaction ends. A save that reads the currency and one that changes it
   * therefore cannot interleave.
   */
  async lockOrCreate(
    executor: Executor,
    { merchantId }: TenantScope,
    defaults: MerchantSettingsValues,
  ): Promise<MerchantSettingsRow> {
    await executor
      .insert(merchantSettings)
      .values({ merchantId, ...defaults })
      .onConflictDoNothing({ target: merchantSettings.merchantId });
    const rows = await executor
      .select()
      .from(merchantSettings)
      .where(eq(merchantSettings.merchantId, merchantId))
      .for('update');
    return one(rows, 'lockOrCreate merchant_settings');
  }

  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    values: Partial<MerchantSettingsValues>,
  ): Promise<MerchantSettingsRow> {
    const rows = await executor
      .update(merchantSettings)
      .set(values)
      .where(eq(merchantSettings.merchantId, merchantId))
      .returning();
    return one(rows, 'update merchant_settings');
  }

  /** Whether the shop has any order, in any status: once it has, the currency is fixed. */
  async hasOrders(executor: Executor, { merchantId }: TenantScope): Promise<boolean> {
    const rows = await executor
      .select({ id: order.id })
      .from(order)
      .where(eq(order.merchantId, merchantId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Multiplies every catalog amount - variant prices and product delivery
   * charges, archived ones too - by `factor`, rounding half away from zero, so
   * a price keeps its number when the currency's decimals change (৳1,600.00
   * stays 1,600 as ¥1,600). Bumps each product's revision, as every write to
   * its variants must.
   */
  async rescaleAmounts(
    executor: Executor,
    { merchantId }: TenantScope,
    factor: string,
  ): Promise<void> {
    const scaled = (column: typeof productVariant.price | typeof product.deliveryCharge) =>
      sql`round(${column}::numeric * ${factor}::numeric)::integer`;
    await executor
      .update(productVariant)
      .set({ price: scaled(productVariant.price) })
      .where(eq(productVariant.merchantId, merchantId));
    await executor
      .update(product)
      .set({
        deliveryCharge: scaled(product.deliveryCharge),
        revision: sql`${product.revision} + 1`,
      })
      .where(eq(product.merchantId, merchantId));
  }
}
