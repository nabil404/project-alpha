import { Inject, Injectable } from '@nestjs/common';
import { deliveryFeeFor, type DeliveryQuote, type DeliveryQuoteRequest } from '@app/shared';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { ProductDeliveryRepository } from '../products/product-delivery.repository';
import { variantNotFound } from '../products/product-errors';
import { DeliveryChargesRepository } from '../settings/delivery-charges.repository';
import { deliveryChargeNotFound } from '../settings/delivery-errors';
import { defaultMerchantSettings } from '../settings/general-settings.service';
import { MerchantSettingsRepository } from '../settings/merchant-settings.repository';
import { OrderCatalogRepository } from './order-catalog.repository';
import { subtotalOf } from './order-rules';

/** What the fee rule needs of an order's lines. */
export interface QuotedLine {
  productId: string | null;
  quantity: number;
  unitPrice: number;
}

/**
 * What delivering an order's items to one area costs (@app/shared
 * deliveryFeeFor). The dashboard prefills an order's fee with it; the
 * assistant will quote with `feeFor`. It writes nothing.
 */
@Injectable()
export class DeliveryQuoteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly charges: DeliveryChargesRepository,
    private readonly productDelivery: ProductDeliveryRepository,
    private readonly catalog: OrderCatalogRepository,
    private readonly settings: MerchantSettingsRepository,
  ) {}

  /**
   * Prices variants as the order would: the price sent, else the catalog's.
   * Archived variants still quote, so an order holding one can be re-priced.
   */
  quote(scope: TenantScope, input: DeliveryQuoteRequest): Promise<DeliveryQuote> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.charges.find(tx, scope, input.deliveryChargeId))) {
        throw deliveryChargeNotFound(input.deliveryChargeId);
      }
      const variants = await this.catalog.findVariants(
        tx,
        scope,
        input.items.map((item) => item.variantId),
      );
      const lines = input.items.map((item) => {
        const variant = variants.get(item.variantId);
        if (!variant) throw variantNotFound(item.variantId);
        return {
          productId: variant.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? variant.price,
        };
      });
      return this.feeFor(tx, scope, input.deliveryChargeId, lines);
    });
  }

  async feeFor(
    tx: Executor,
    scope: TenantScope,
    deliveryChargeId: string,
    lines: readonly QuotedLine[],
  ): Promise<DeliveryQuote> {
    const area = await this.charges.find(tx, scope, deliveryChargeId);
    if (!area) throw deliveryChargeNotFound(deliveryChargeId);
    const freeDeliveryOver =
      ((await this.settings.find(tx, scope)) ?? defaultMerchantSettings()).freeDeliveryOver ?? null;
    const productIds = [
      ...new Set(lines.flatMap((line) => (line.productId ? [line.productId] : []))),
    ];
    const own = await this.productDelivery.forProducts(tx, scope, productIds, area.id);
    const subtotal = subtotalOf(lines);
    const fee = deliveryFeeFor({
      shopCharge: area.charge,
      productCharges: productIds.map((id) => own.get(id) ?? null),
      subtotal,
      freeDeliveryOver,
    });
    return {
      fee,
      subtotal,
      freeDeliveryApplied: freeDeliveryOver !== null && subtotal >= freeDeliveryOver,
    };
  }
}
