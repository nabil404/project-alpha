import { saveProductSchema, type Product, type SaveProduct } from '@app/shared';
import { CategoriesRepository } from '../../categories/categories.repository';
import type { Database } from '../../database/database.module';
import type { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { ProductImageRepository } from '../images/product-image.repository';
import { ProductOptionsRepository } from '../options/product-options.repository';
import { ProductWriter } from '../options/product-writer';
import { ProductsRepository } from '../products.repository';
import { ProductsService } from '../products.service';

/** ProductsService wired by hand, as Nest would. */
export function productsService(
  db: Database,
  storage: ObjectStorage = new InMemoryObjectStorage(),
): ProductsService {
  const products = new ProductsRepository();
  const options = new ProductOptionsRepository();
  return new ProductsService(
    db,
    products,
    new CategoriesRepository(),
    new ProductImageRepository(),
    options,
    new ProductWriter(products, options),
    storage,
  );
}

/** What the edit page sends back for a product it read and did not change. */
export function documentOf(product: Product): SaveProduct {
  const text = new Map(
    product.options.flatMap((o) => o.values.map((v) => [v.id, v.value] as const)),
  );
  return saveProductSchema.parse({
    version: product.version,
    name: product.name,
    description: product.description,
    status: product.status,
    aliases: product.aliases,
    deliveryCharge: product.deliveryCharge,
    categoryIds: product.categoryIds,
    coverImageId: product.coverImageId,
    options: product.options.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, value: v.value })),
    })),
    variants: product.variants.map((v) => ({
      id: v.id,
      optionValues: v.optionValueIds.map((id) => text.get(id)!),
      sku: v.sku,
      price: v.price,
      stock: v.stock,
      imageId: v.imageId,
    })),
  });
}
