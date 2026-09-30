import type { Product, ProductImage, Variant } from '@app/shared';
import type { ProductImageRow } from '../database/schema/index';
import type { ObjectStorage } from '../storage/object-storage';
import { productImageKeys } from './images/product-image-keys';
import type {
  OptionRow,
  OptionValueRow,
  VariantOptionValueRow,
} from './options/product-options.repository';
import type { ProductRow, VariantRow } from './products.repository';

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

/** `optionValueIds` in the product's option order. */
export function toVariant(row: VariantRow, optionValueIds: string[]): Variant {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    price: row.price,
    stock: row.stock,
    stockStatus: row.stock > 0 ? 'in_stock' : 'out_of_stock',
    isDefault: row.isDefault,
    imageId: row.imageId,
    optionValueIds,
  };
}

/** One product's rows: options and values by position, images in gallery order. */
export interface ProductParts {
  variants: VariantRow[];
  options: OptionRow[];
  values: OptionValueRow[];
  links: VariantOptionValueRow[];
  categoryIds: string[];
  images: ProductImage[];
}

/** Variants sort by their values' positions, option by option, as the edit table and the assistant list them. */
export function toProduct(row: ProductRow, parts: ProductParts): Product {
  const position = new Map(parts.values.map((value) => [value.id, value.position]));
  const valueIdsOf = (variantId: string) =>
    parts.options.flatMap((option) => {
      const link = parts.links.find((l) => l.variantId === variantId && l.optionId === option.id);
      return link ? [link.optionValueId] : [];
    });
  const byValuePositions = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const diff = (position.get(a[i]!) ?? 0) - (position.get(b[i]!) ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    aliases: row.aliases,
    categoryIds: parts.categoryIds,
    images: parts.images,
    coverImageId: row.coverImageId,
    options: parts.options.map((option) => ({
      id: option.id,
      name: option.name,
      values: parts.values
        .filter((value) => value.optionId === option.id)
        .map((value) => ({ id: value.id, value: value.value })),
    })),
    deliveryCharge: row.deliveryCharge,
    variants: parts.variants
      .map((variant) => ({ variant, valueIds: valueIdsOf(variant.id) }))
      .sort((a, b) => byValuePositions(a.valueIds, b.valueIds))
      .map(({ variant, valueIds }) => toVariant(variant, valueIds)),
    version: String(row.revision),
  };
}
