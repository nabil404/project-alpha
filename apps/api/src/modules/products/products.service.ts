import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createProductSchema,
  saveProductSchema,
  type Category,
  type CreateProduct,
  type Product,
  type SaveProduct,
  type UpdateProduct,
  type UpdateVariant,
  updateVariantSchema,
} from '@app/shared';
import { parseOrThrow } from '../../common/parse-or-throw';
import type { TenantScope, Transaction } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import { isForeignKeyViolation } from '../database/pg-errors';
import { withMerchant } from '../database/with-merchant';
import { toCategory } from '../categories/category-mappers';
import { CategoriesRepository } from '../categories/categories.repository';
import { categoryNotFound } from '../categories/category-errors';
import { ObjectStorage } from '../storage/object-storage';
import { deleteObjectsQuietly, objectKeysFor } from './images/product-image-objects';
import { ProductImageRepository } from './images/product-image.repository';
import { EMPTY_PRODUCT_STATE, planProductDocument } from './options/product-document-plan';
import { ProductOptionsRepository } from './options/product-options.repository';
import { ProductWriter } from './options/product-writer';
import {
  guardSku,
  productImageNotFound,
  productInUse,
  productNotFound,
  productStale,
  variantNotFound,
} from './product-errors';
import { toProduct, toProductImage } from './product-mappers';
import { ProductsRepository, type ProductRow } from './products.repository';
import { normalizeSku } from './sku';

/** What the AI may quote from: nothing a seller has drafted, archived or deleted. */
export interface SellableCatalog {
  products: Product[];
  categories: Category[];
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly images: ProductImageRepository,
    private readonly options: ProductOptionsRepository,
    private readonly writer: ProductWriter,
    private readonly storage: ObjectStorage,
  ) {}

  async create(merchantId: string, input: CreateProduct): Promise<Product> {
    // The pipe already parsed this; parsing again holds the rules for any caller that skips it.
    const doc = parseOrThrow(createProductSchema, input);
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const row = await this.products.insertProduct(tx, scope, {
        name: doc.name,
        description: doc.description,
        status: doc.status,
        aliases: doc.aliases,
        deliveryCharge: doc.deliveryCharge,
      });
      await this.writer.apply(tx, scope, row.id, planProductDocument(EMPTY_PRODUCT_STATE, doc));
      await this.linkCategories(tx, scope, row.id, doc.categoryIds);
      return this.load(tx, scope, row.id);
    });
  }

  get(merchantId: string, id: string): Promise<Product> {
    return withMerchant(this.db, merchantId, (tx) => this.load(tx, { merchantId }, id));
  }

  /**
   * The edit page's Save: the whole document in one transaction. The row lock
   * serializes saves, so of two made from the same read the second sees the
   * first's revision and is refused rather than overwriting it.
   */
  async save(merchantId: string, id: string, input: SaveProduct): Promise<Product> {
    const doc = parseOrThrow(saveProductSchema, input);
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const row = await this.products.findProduct(tx, scope, id, { lock: true });
      if (!row) throw productNotFound(id);
      const current = await this.assembleOne(tx, scope, row);
      if (current.version !== doc.version) throw productStale(id);

      const plan = planProductDocument(
        {
          options: current.options,
          variantIds: current.variants.map((variant) => variant.id),
          imageIds: current.images.map((image) => image.id),
        },
        doc,
      );
      await this.products.updateProduct(tx, scope, id, {
        name: doc.name,
        description: doc.description,
        status: doc.status,
        aliases: doc.aliases,
        deliveryCharge: doc.deliveryCharge,
        coverImageId: plan.coverImageId ?? null,
      });
      await this.writer.apply(tx, scope, id, plan);
      await this.linkCategories(tx, scope, id, doc.categoryIds);
      return this.load(tx, scope, id);
    });
  }

  /** A partial change (the status dropdown, say). Any change bumps the version. */
  update(merchantId: string, id: string, input: UpdateProduct): Promise<Product> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const { categoryIds, ...fields } = input;
      if (!(await this.products.findProduct(tx, scope, id, { lock: true }))) {
        throw productNotFound(id);
      }

      if (Object.values(input).some((value) => value !== undefined)) {
        await this.products.updateProduct(tx, scope, id, fields);
      }
      if (categoryIds !== undefined) await this.linkCategories(tx, scope, id, categoryIds);
      return this.load(tx, scope, id);
    });
  }

  /**
   * One live variant's own fields, outside the document save (a quick stock
   * change, say). It bumps the product's version, so an edit page still
   * holding the old one cannot overwrite the change with a stale save.
   */
  async updateVariant(
    merchantId: string,
    productId: string,
    variantId: string,
    input: UpdateVariant,
  ): Promise<Product> {
    const fields = parseOrThrow(updateVariantSchema, input);
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) {
        throw productNotFound(productId);
      }
      const live = await this.products.liveVariants(tx, scope, [productId]);
      if (!live.some((variant) => variant.id === variantId)) throw variantNotFound(variantId);
      // The foreign key keeps the image within the merchant; this keeps it within the product.
      if (fields.imageId) {
        const own = await this.images.listForProducts(tx, scope, [productId]);
        if (!own.some((image) => image.id === fields.imageId)) {
          throw productImageNotFound(fields.imageId);
        }
      }

      if (Object.values(fields).some((value) => value !== undefined)) {
        const sku = fields.sku === undefined ? undefined : (normalizeSku(fields.sku) ?? undefined);
        await guardSku(sku, () =>
          this.products.updateVariant(tx, scope, variantId, { ...fields, sku }),
        );
        await this.products.updateProduct(tx, scope, productId, {});
      }
      return this.load(tx, scope, productId);
    });
  }

  /**
   * The database refuses this once an order references a variant; the seller
   * archives instead. Image rows cascade; their objects go after commit, so a
   * refused delete keeps them.
   */
  async remove(merchantId: string, id: string): Promise<void> {
    let keys: string[];
    try {
      keys = await withMerchant(this.db, merchantId, async (tx) => {
        const scope = { merchantId };
        const images = await this.images.listForProducts(tx, scope, [id]);
        if (!(await this.products.deleteProduct(tx, scope, id))) throw productNotFound(id);
        return objectKeysFor(images);
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw productInUse(id);
      throw error;
    }
    await deleteObjectsQuietly(this.storage, this.logger, keys);
  }

  /** The AI's read. Active products only, with their options, live variants and live categories. */
  findSellableCatalog(merchantId: string): Promise<SellableCatalog> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const rows = await this.products.listSellable(tx, scope);
      const categories = await this.categories.listLive(tx, scope);
      return {
        products: await this.assemble(tx, scope, rows),
        categories: categories.map(toCategory),
      };
    });
  }

  /** The dashboard view: any status. */
  protected async load(tx: Transaction, scope: TenantScope, id: string): Promise<Product> {
    const row = await this.products.findProduct(tx, scope, id);
    if (!row) throw productNotFound(id);
    return this.assembleOne(tx, scope, row);
  }

  private async assembleOne(
    tx: Transaction,
    scope: TenantScope,
    row: ProductRow,
  ): Promise<Product> {
    const [product] = await this.assemble(tx, scope, [row]);
    return product!;
  }

  /** Everything toProduct needs for these rows, one query per table however many rows. */
  private async assemble(
    tx: Transaction,
    scope: TenantScope,
    rows: ProductRow[],
  ): Promise<Product[]> {
    const ids = rows.map((row) => row.id);
    const variants = await this.products.liveVariants(tx, scope, ids);
    const { options, values } = await this.options.listForProducts(tx, scope, ids);
    const links = await this.options.linksForVariants(
      tx,
      scope,
      variants.map((variant) => variant.id),
    );
    const categoryIds = await this.products.categoryIdsByProduct(tx, scope, ids);
    const images = await this.images.listForProducts(tx, scope, ids);

    return rows.map((row) => {
      const ownVariants = variants.filter((variant) => variant.productId === row.id);
      const ownVariantIds = new Set(ownVariants.map((variant) => variant.id));
      const ownOptions = options.filter((option) => option.productId === row.id);
      const ownOptionIds = new Set(ownOptions.map((option) => option.id));
      return toProduct(row, {
        variants: ownVariants,
        options: ownOptions,
        values: values.filter((value) => ownOptionIds.has(value.optionId)),
        links: links.filter((link) => ownVariantIds.has(link.variantId)),
        categoryIds: categoryIds.get(row.id) ?? [],
        images: images
          .filter((image) => image.productId === row.id)
          .map((image) => toProductImage(image, this.storage)),
      });
    });
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
      if ((await this.categories.countLive(tx, scope, ids)) !== ids.length) {
        throw categoryNotFound();
      }
    }
    await this.products.setCategories(tx, scope, productId, ids);
  }
}
