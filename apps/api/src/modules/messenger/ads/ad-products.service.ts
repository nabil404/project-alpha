import { Inject, Injectable } from '@nestjs/common';
import type { AdProduct, AdProductListResponse, UpdateAdProduct } from '@app/shared';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { productNotFound } from '../../products/product-errors';
import { ProductsRepository } from '../../products/products.repository';
import { adProductArchived, adProductNotFound } from './ad-product-errors';
import { AdProductRepository, type AdProductListRow } from './ad-product.repository';

@Injectable()
export class AdProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly ads: AdProductRepository,
    private readonly products: ProductsRepository,
  ) {}

  list(scope: TenantScope): Promise<AdProductListResponse> {
    return withMerchant(this.db, scope.merchantId, async (tx) => ({
      data: (await this.ads.list(tx, scope)).map(toAdProduct),
    }));
  }

  /** A Draft product is allowed: the assistant ignores it until it is Published. */
  setProduct(scope: TenantScope, id: string, { productId }: UpdateAdProduct): Promise<AdProduct> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.ads.find(tx, scope, id))) throw adProductNotFound(id);
      if (productId !== null) {
        const product = await this.products.findProduct(tx, scope, productId);
        if (!product) throw productNotFound(productId);
        if (product.status === 'archived') throw adProductArchived(productId);
      }
      await this.ads.setProduct(tx, scope, id, productId);
      const updated = await this.ads.find(tx, scope, id);
      if (!updated) throw adProductNotFound(id);
      return toAdProduct(updated);
    });
  }
}

function toAdProduct(row: AdProductListRow): AdProduct {
  return {
    id: row.id,
    adId: row.adId,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    chatCount: row.chatCount,
    product:
      row.productId && row.productName && row.productStatus
        ? { id: row.productId, name: row.productName, status: row.productStatus }
        : null,
  };
}
