import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRODUCT_IMAGE_MAX_COUNT, type ProductImage } from '@app/shared';
import type { TenantScope, Transaction } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { ObjectStorage } from '../../storage/object-storage';
import {
  productImageInvalid,
  productImageLimitReached,
  productImageNotFound,
  productImageOrderMismatch,
  productImageUnsupported,
  productNotFound,
} from '../product-errors';
import { toProductImage } from '../product-mappers';
import { ProductsRepository } from '../products.repository';
import { normalizeProductImage, type NormalizedImage } from './normalize-product-image';
import { deleteObjectsQuietly, objectKeysFor } from './product-image-objects';
import { PRODUCT_IMAGE_OBJECT_OPTIONS, productImageKeys } from './product-image-keys';
import { ProductImageRepository } from './product-image.repository';

/**
 * The upload order is load-bearing (backend invariant #1): check, process,
 * store, and only then open a short transaction that locks the product,
 * re-checks, and inserts. No sharp or storage call ever runs inside a
 * transaction. Anything a best-effort delete misses is left to the orphan sweep.
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsRepository,
    private readonly images: ProductImageRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(scope: TenantScope, productId: string, file: Buffer): Promise<ProductImage> {
    // A cheap refusal before the expensive work; the transaction below re-checks.
    await withMerchant(this.db, scope.merchantId, (tx) =>
      this.countWithRoom(tx, scope, productId, { lock: false }),
    );

    const image = await normalizeProductImage(file);
    if (!image.ok) {
      throw image.reason === 'unsupported' ? productImageUnsupported() : productImageInvalid();
    }

    const id = randomUUID();
    const keys = productImageKeys(scope.merchantId, id);
    await this.storeBoth(keys, image);

    try {
      const row = await withMerchant(this.db, scope.merchantId, async (tx) => {
        const position = await this.countWithRoom(tx, scope, productId, { lock: true });
        return this.images.insert(tx, scope, {
          id,
          productId,
          storageKey: keys.full,
          position,
          width: image.width,
          height: image.height,
          byteSize: image.byteSize,
        });
      });
      return toProductImage(row, this.storage);
    } catch (error) {
      await deleteObjectsQuietly(this.storage, this.logger, [keys.full, keys.thumbnail]);
      throw error;
    }
  }

  async delete(scope: TenantScope, productId: string, imageId: string): Promise<void> {
    const deleted = await withMerchant(this.db, scope.merchantId, async (tx) => {
      // Another merchant's product answers exactly as a missing image does.
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) return null;
      const row = await this.images.delete(tx, scope, productId, imageId);
      if (row) {
        const remaining = await this.images.listForProducts(tx, scope, [productId]);
        await this.images.setPositions(
          tx,
          scope,
          productId,
          remaining.map((image) => image.id),
        );
      }
      return row;
    });

    if (!deleted) throw productImageNotFound(imageId);
    await deleteObjectsQuietly(this.storage, this.logger, objectKeysFor([deleted]));
  }

  async reorder(
    scope: TenantScope,
    productId: string,
    imageIds: string[],
  ): Promise<ProductImage[]> {
    const rows = await withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.products.findProduct(tx, scope, productId, { lock: true }))) {
        throw productNotFound(productId);
      }
      const current = await this.images.listForProducts(tx, scope, [productId]);
      if (
        !isPermutationOf(
          imageIds,
          current.map((image) => image.id),
        )
      ) {
        throw productImageOrderMismatch();
      }
      await this.images.setPositions(tx, scope, productId, imageIds);
      return this.images.listForProducts(tx, scope, [productId]);
    });
    return rows.map((row) => toProductImage(row, this.storage));
  }

  /**
   * The product's image count, which is also the next position, after proving
   * the product is this merchant's and has room. `lock` holds the product row,
   * serializing gallery changes, until the transaction ends.
   */
  private async countWithRoom(
    tx: Transaction,
    scope: TenantScope,
    productId: string,
    { lock }: { lock: boolean },
  ): Promise<number> {
    if (!(await this.products.findProduct(tx, scope, productId, { lock }))) {
      throw productNotFound(productId);
    }
    const count = await this.images.count(tx, scope, productId);
    if (count >= PRODUCT_IMAGE_MAX_COUNT) throw productImageLimitReached();
    return count;
  }

  private async storeBoth(
    keys: { full: string; thumbnail: string },
    image: NormalizedImage,
  ): Promise<void> {
    try {
      await this.storage.put(keys.full, image.full, PRODUCT_IMAGE_OBJECT_OPTIONS);
      await this.storage.put(keys.thumbnail, image.thumbnail, PRODUCT_IMAGE_OBJECT_OPTIONS);
    } catch (error) {
      await deleteObjectsQuietly(this.storage, this.logger, [keys.full, keys.thumbnail]);
      throw error;
    }
  }
}

function isPermutationOf(candidate: string[], current: string[]): boolean {
  return (
    candidate.length === current.length &&
    new Set(candidate).size === candidate.length &&
    candidate.every((id) => current.includes(id))
  );
}
