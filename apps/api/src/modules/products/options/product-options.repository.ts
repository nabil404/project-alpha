import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import {
  productOption,
  productOptionValue,
  productVariantOptionValue,
} from '../../database/schema/index';

export type OptionRow = typeof productOption.$inferSelect;
export type OptionValueRow = typeof productOptionValue.$inferSelect;
export type VariantOptionValueRow = typeof productVariantOptionValue.$inferSelect;

/**
 * Rows only. Locking the product row, which serializes every option and
 * variant change, is ProductsRepository's; the rules are the planner's.
 */
@Injectable()
export class ProductOptionsRepository {
  /** These products' options and those options' values, each ordered by position. */
  async listForProducts(
    executor: Executor,
    { merchantId }: TenantScope,
    productIds: string[],
  ): Promise<{ options: OptionRow[]; values: OptionValueRow[] }> {
    if (productIds.length === 0) return { options: [], values: [] };
    const options = await executor
      .select()
      .from(productOption)
      .where(
        and(eq(productOption.merchantId, merchantId), inArray(productOption.productId, productIds)),
      )
      .orderBy(asc(productOption.position), asc(productOption.createdAt));
    if (options.length === 0) return { options, values: [] };

    const values = await executor
      .select()
      .from(productOptionValue)
      .where(
        and(
          eq(productOptionValue.merchantId, merchantId),
          inArray(
            productOptionValue.optionId,
            options.map((option) => option.id),
          ),
        ),
      )
      .orderBy(asc(productOptionValue.position), asc(productOptionValue.createdAt));
    return { options, values };
  }

  async linksForVariants(
    executor: Executor,
    { merchantId }: TenantScope,
    variantIds: string[],
  ): Promise<VariantOptionValueRow[]> {
    if (variantIds.length === 0) return [];
    return executor
      .select()
      .from(productVariantOptionValue)
      .where(
        and(
          eq(productVariantOptionValue.merchantId, merchantId),
          inArray(productVariantOptionValue.variantId, variantIds),
        ),
      );
  }

  async insertOption(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { productId: string; name: string; position: number },
  ): Promise<OptionRow> {
    return one(
      await executor
        .insert(productOption)
        .values({ merchantId, ...values })
        .returning(),
      'option insert',
    );
  }

  async updateOption(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: { name: string; position: number },
  ): Promise<void> {
    await executor
      .update(productOption)
      .set(values)
      .where(and(eq(productOption.merchantId, merchantId), eq(productOption.id, id)));
  }

  /** Their values and those values' variant links cascade. */
  async deleteOptions(
    executor: Executor,
    { merchantId }: TenantScope,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await executor
      .delete(productOption)
      .where(and(eq(productOption.merchantId, merchantId), inArray(productOption.id, ids)));
  }

  async insertValue(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { optionId: string; value: string; position: number },
  ): Promise<OptionValueRow> {
    return one(
      await executor
        .insert(productOptionValue)
        .values({ merchantId, ...values })
        .returning(),
      'option value insert',
    );
  }

  async updateValue(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: { value: string; position: number },
  ): Promise<void> {
    await executor
      .update(productOptionValue)
      .set(values)
      .where(and(eq(productOptionValue.merchantId, merchantId), eq(productOptionValue.id, id)));
  }

  /** Their variant links cascade. */
  async deleteValues(
    executor: Executor,
    { merchantId }: TenantScope,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await executor
      .delete(productOptionValue)
      .where(
        and(eq(productOptionValue.merchantId, merchantId), inArray(productOptionValue.id, ids)),
      );
  }

  /** Replaces the variant's links with exactly these. */
  async setVariantValues(
    executor: Executor,
    { merchantId }: TenantScope,
    variantId: string,
    links: { optionId: string; optionValueId: string }[],
  ): Promise<void> {
    await executor
      .delete(productVariantOptionValue)
      .where(
        and(
          eq(productVariantOptionValue.merchantId, merchantId),
          eq(productVariantOptionValue.variantId, variantId),
        ),
      );
    if (links.length > 0) {
      await executor
        .insert(productVariantOptionValue)
        .values(links.map((link) => ({ merchantId, variantId, ...link })));
    }
  }
}
