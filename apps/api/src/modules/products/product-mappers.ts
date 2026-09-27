import type { Product, Variant } from '@app/shared';
import type { ProductRow, VariantRow } from './products.repository.js';

export function toVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    price: row.price,
    stock: row.stock,
    stockStatus: row.stock > 0 ? 'in_stock' : 'out_of_stock',
    isDefault: row.isDefault,
    // Set by the product image design's variant.image_id, which does not exist yet.
    imageId: null,
  };
}

export function toProduct(row: ProductRow, variants: VariantRow[], categoryIds: string[]): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    aliases: row.aliases,
    categoryIds,
    // Filled by the product image design.
    images: [],
    deliveryCharge: row.deliveryCharge,
    variants: variants.map(toVariant),
  };
}
