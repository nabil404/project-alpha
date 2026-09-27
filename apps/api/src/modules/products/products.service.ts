import { Inject, Injectable } from '@nestjs/common';
import type { CreateProduct, Product, UpdateProduct } from '@app/shared';
import type { TenantScope, Transaction } from '../../database/base.repository.js';
import { DATABASE, type Database } from '../../database/database.module.js';
import { withMerchant } from '../../database/with-merchant.js';
import { CategoriesRepository } from '../categories/categories.repository.js';
import { categoryNotFound } from '../categories/category-errors.js';
import { guardSku, productNotFound, variantNameRequired } from './product-errors.js';
import { toProduct } from './product-mappers.js';
import { ProductsRepository } from './products.repository.js';
import { normalizeSku } from './sku.js';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  create(merchantId: string, input: CreateProduct): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      // The shared schema refines this too; the service holds the rule for any caller.
      if (input.variants.length > 1 && input.variants.some((v) => v.name === null)) {
        throw variantNameRequired();
      }

      const row = await this.products.insertProduct(tx, scope, {
        name: input.name,
        description: input.description,
        status: input.status,
        aliases: input.aliases,
        deliveryCharge: input.deliveryCharge,
      });

      for (const variant of input.variants) {
        const sku = normalizeSku(variant.sku);
        await guardSku(sku, () =>
          this.products.insertVariant(tx, scope, {
            productId: row.id,
            name: variant.name,
            sku,
            price: variant.price,
            stock: variant.stock,
          }),
        );
      }

      await this.linkCategories(tx, scope, row.id, input.categoryIds);
      return this.load(tx, scope, row.id);
    });
  }

  get(merchantId: string, id: string): Promise<Product> {
    return withMerchant(this.db, merchantId, (tx) => this.load(tx, { merchantId }, id));
  }

  update(merchantId: string, id: string, input: UpdateProduct): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const { categoryIds, ...fields } = input;
      if (!(await this.products.findProduct(tx, scope, id, { lock: true })))
        throw productNotFound(id);

      if (Object.values(fields).some((value) => value !== undefined)) {
        await this.products.updateProduct(tx, scope, id, fields);
      }
      if (categoryIds !== undefined) await this.linkCategories(tx, scope, id, categoryIds);
      return this.load(tx, scope, id);
    });
  }

  /** The database refuses this once an order references a variant; the seller archives instead. */
  remove(merchantId: string, id: string): Promise<void> {
    return withMerchant(this.db, merchantId, async (tx) => {
      if (!(await this.products.deleteProduct(tx, { merchantId }, id))) throw productNotFound(id);
    });
  }

  /** The dashboard view: any status, live variants, live categories. */
  protected async load(tx: Transaction, scope: TenantScope, id: string): Promise<Product> {
    const row = await this.products.findProduct(tx, scope, id);
    if (!row) throw productNotFound(id);
    const variants = await this.products.liveVariants(tx, scope, [id]);
    const categoryIds = await this.products.categoryIdsByProduct(tx, scope, [id]);
    return toProduct(row, variants, categoryIds.get(id) ?? []);
  }

  private async linkCategories(
    tx: Transaction,
    scope: TenantScope,
    productId: string,
    categoryIds: string[],
  ): Promise<void> {
    const ids = [...new Set(categoryIds)];
    if (ids.length > 0) {
      // Category deletion holds the same lock, so a category cannot be deleted
      // between this liveness check and the link being written.
      await this.categories.lockTree(tx, scope);
      if ((await this.categories.countLive(tx, scope, ids)) !== ids.length)
        throw categoryNotFound();
    }
    await this.products.setCategories(tx, scope, productId, ids);
  }
}
