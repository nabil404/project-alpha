import { Inject, Injectable } from '@nestjs/common';
import type { AddVariant, CreateProduct, Product, UpdateProduct, UpdateVariant } from '@app/shared';
import type { TenantScope, Transaction } from '../../database/base.repository.js';
import { CodedConflictException } from '../../common/errors/index.js';
import { DATABASE, type Database } from '../../database/database.module.js';
import { withMerchant } from '../../database/with-merchant.js';
import { CategoriesRepository } from '../categories/categories.repository.js';
import { categoryNotFound } from '../categories/category-errors.js';
import {
  guardSku,
  productNotFound,
  variantNameRequired,
  variantNotFound,
} from './product-errors.js';
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

  /**
   * Adding to a product sold without options turns it into one with options,
   * so its unnamed default variant must be named in the same call.
   */
  addVariant(merchantId: string, productId: string, input: AddVariant): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) {
        throw productNotFound(productId);
      }

      const live = await this.products.liveVariants(tx, scope, [productId]);
      const defaultVariant = live.find((v) => v.isDefault);
      if (defaultVariant) {
        if (input.defaultVariantName === undefined) throw variantNameRequired();
        await this.products.updateVariant(tx, scope, defaultVariant.id, {
          name: input.defaultVariantName,
        });
      }

      const sku = normalizeSku(input.sku);
      await guardSku(sku, () =>
        this.products.insertVariant(tx, scope, {
          productId,
          name: input.name,
          sku,
          price: input.price,
          stock: input.stock,
        }),
      );
      return this.load(tx, scope, productId);
    });
  }

  /** `name: null` is allowed only on the single live variant, which then becomes the default. */
  updateVariant(
    merchantId: string,
    productId: string,
    variantId: string,
    input: UpdateVariant,
  ): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) {
        throw productNotFound(productId);
      }

      const live = await this.products.liveVariants(tx, scope, [productId]);
      const target = live.find((v) => v.id === variantId);
      if (!target) throw variantNotFound(variantId);
      if (input.name === null && live.length > 1) throw variantNameRequired();

      const sku = input.sku === undefined ? undefined : (normalizeSku(input.sku) ?? target.sku);
      const values = { name: input.name, sku, price: input.price, stock: input.stock };
      if (Object.values(values).some((value) => value !== undefined)) {
        await guardSku(sku, () => this.products.updateVariant(tx, scope, variantId, values));
      }
      return this.load(tx, scope, productId);
    });
  }

  /**
   * Archived rather than deleted: order lines will reference variants, and an
   * archived variant releases its SKU. The product row lock serializes this
   * with other variant changes, so two archives cannot both pass the
   * last-variant check.
   */
  archiveVariant(merchantId: string, productId: string, variantId: string): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) {
        throw productNotFound(productId);
      }

      const live = await this.products.liveVariants(tx, scope, [productId]);
      if (!live.some((v) => v.id === variantId)) throw variantNotFound(variantId);
      if (live.length === 1) {
        throw new CodedConflictException(
          'PRODUCT_NEEDS_VARIANT',
          'A product needs at least one variant',
          {
            id: productId,
          },
        );
      }

      await this.products.archiveVariant(tx, scope, variantId);
      return this.load(tx, scope, productId);
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
