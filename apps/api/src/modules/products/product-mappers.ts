import type { Product, ProductImage, Variant } from '@app/shared';
import type { ProductImageRow } from '../../database/schema/index.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { productImageKeys } from './images/product-image-keys.js';
import type { ProductRow, VariantRow } from './products.repository.js';

/** URLs are built from keys on every read, never stored. */
export function toProductImage(
  row: ProductImageRow,
  storage: Pick<ObjectStorage, 'publicUrl'>,
): ProductImage {
  return {
    id: row.id,
    url: storage.publicUrl(row.storageKey),
    thumbnailUrl: storage.publicUrl(productImageKeys(row.merchantId, row.id).thumbnail),
    position: row.position,
    width: row.width,
    height: row.height,
  };
}

export function toVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    price: row.price,
    stock: row.stock,
    stockStatus: row.stock > 0 ? 'in_stock' : 'out_of_stock',
    isDefault: row.isDefault,
    imageId: row.imageId,
  };
}

/** `images` must already be this product's, cover first. */
export function toProduct(
  row: ProductRow,
  variants: VariantRow[],
  categoryIds: string[],
  images: ProductImage[],
): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    aliases: row.aliases,
    categoryIds,
    images,
    deliveryCharge: row.deliveryCharge,
    variants: variants.map(toVariant),
  };
}
