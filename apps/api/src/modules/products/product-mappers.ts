import {
  stockLevelOf,
  type Product,
  type ProductImage,
  type ProductListItem,
  type StockLevel,
  type Variant,
} from '@app/shared';
import type { ProductImageRow } from '../database/schema/index';
import type { ObjectStorage } from '../storage/object-storage';
import { productImageKeys } from './images/product-image-keys';
import type {
  OptionRow,
  OptionValueRow,
  VariantOptionValueRow,
} from './options/product-options.repository';
import type { ProductListRow, ProductRow, ProductTotals, VariantRow } from './products.repository';

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
    // wire renamed in Task 6
    deliveryCharge: 0,
    variants: parts.variants
      .map((variant) => ({ variant, valueIds: valueIdsOf(variant.id) }))
      .sort((a, b) => byValuePositions(a.valueIds, b.valueIds))
      .map(({ variant, valueIds }) => toVariant(variant, valueIds)),
    version: String(row.revision),
  };
}

/** The same rules as the list's stock filters, so a row always sits under the chip it counts in. */
export function productStockLevel(totals: ProductTotals): StockLevel {
  if (totals.stock === 0) return 'out_of_stock';
  return totals.lowCount + totals.outCount > 0 ? 'low_stock' : 'in_stock';
}

/** A list row. `onlyVariant` is the live variant of a product that has exactly one. */
export function toProductListItem(
  { product: row, totals }: ProductListRow,
  parts: { categoryIds: string[]; optionNames: string[]; onlyVariant: VariantRow | undefined },
  storage: Pick<ObjectStorage, 'publicUrl'>,
): ProductListItem {
  const thumbnail = (imageId: string | null) =>
    imageId === null
      ? null
      : storage.publicUrl(productImageKeys(row.merchantId, imageId).thumbnail);
  const only = totals.variantCount === 1 ? parts.onlyVariant : undefined;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    categoryIds: parts.categoryIds,
    coverThumbnailUrl: thumbnail(row.coverImageId),
    optionNames: parts.optionNames,
    variantCount: totals.variantCount,
    priceMin: totals.priceMin,
    priceMax: totals.priceMax,
    stock: totals.stock,
    lowVariantCount: totals.lowCount,
    outVariantCount: totals.outCount,
    stockLevel: productStockLevel(totals),
    variant: only
      ? {
          id: only.id,
          name: only.name,
          sku: only.sku,
          price: only.price,
          stock: only.stock,
          stockLevel: stockLevelOf(only.stock),
          thumbnailUrl: thumbnail(only.imageId ?? row.coverImageId),
        }
      : null,
  };
}
