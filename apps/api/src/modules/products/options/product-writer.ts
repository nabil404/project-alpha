import { Injectable } from '@nestjs/common';
import type { TenantScope, Transaction } from '../../database/base.repository';
import { guardSku } from '../product-errors';
import { ProductsRepository } from '../products.repository';
import type { ProductDocumentPlan } from './product-document-plan';
import { ProductOptionsRepository } from './product-options.repository';

@Injectable()
export class ProductWriter {
  constructor(
    private readonly products: ProductsRepository,
    private readonly options: ProductOptionsRepository,
  ) {}

  /**
   * Applies a plan inside the caller's transaction, which must hold the
   * product row lock. Archiving comes first, so a leaving variant releases its
   * SKU and the default slot before a staying or new one claims them; deleting
   * comes next, so its cascades never reach links written below.
   */
  async apply(
    tx: Transaction,
    scope: TenantScope,
    productId: string,
    plan: ProductDocumentPlan,
  ): Promise<void> {
    for (const id of plan.archiveVariantIds) await this.products.archiveVariant(tx, scope, id);
    await this.options.deleteOptions(tx, scope, plan.deleteOptionIds);
    await this.options.deleteValues(tx, scope, plan.deleteValueIds);

    const optionIds: string[] = [];
    const valueIds: string[][] = [];
    for (const option of plan.options) {
      let optionId = option.id;
      if (optionId) {
        await this.options.updateOption(tx, scope, optionId, {
          name: option.name,
          position: option.position,
        });
      } else {
        optionId = (
          await this.options.insertOption(tx, scope, {
            productId,
            name: option.name,
            position: option.position,
          })
        ).id;
      }
      const ids: string[] = [];
      for (const value of option.values) {
        if (value.id) {
          await this.options.updateValue(tx, scope, value.id, {
            value: value.value,
            position: value.position,
          });
          ids.push(value.id);
        } else {
          const inserted = await this.options.insertValue(tx, scope, {
            optionId,
            value: value.value,
            position: value.position,
          });
          ids.push(inserted.id);
        }
      }
      optionIds.push(optionId);
      valueIds.push(ids);
    }

    // The live-SKU index is checked row by row, so a swap between surviving
    // variants, or a new variant taking a SKU one gives up, would collide
    // halfway. Every surviving variant whose SKU is written below first moves
    // to a placeholder only it can hold (its own id).
    for (const variant of plan.variants) {
      if (variant.id && variant.sku !== null) {
        await this.products.updateVariant(tx, scope, variant.id, { sku: `PARKED-${variant.id}` });
      }
    }

    for (const variant of plan.variants) {
      let variantId = variant.id;
      if (variantId) {
        const id = variantId;
        await guardSku(variant.sku, () =>
          this.products.updateVariant(tx, scope, id, {
            name: variant.name,
            price: variant.price,
            stock: variant.stock,
            imageId: variant.imageId,
            // A blank SKU on an existing variant keeps the one it has.
            ...(variant.sku === null ? {} : { sku: variant.sku }),
          }),
        );
      } else {
        const inserted = await guardSku(variant.sku, () =>
          this.products.insertVariant(tx, scope, {
            productId,
            name: variant.name,
            sku: variant.sku,
            price: variant.price,
            stock: variant.stock,
            imageId: variant.imageId,
          }),
        );
        variantId = inserted.id;
      }
      await this.options.setVariantValues(
        tx,
        scope,
        variantId,
        variant.valueRefs.map((ref) => ({
          optionId: optionIds[ref.option]!,
          optionValueId: valueIds[ref.option]![ref.value]!,
        })),
      );
    }
  }
}
