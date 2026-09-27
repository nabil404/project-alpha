import { createProductSchema } from '@app/shared';
import { CategoriesRepository } from '../../categories/categories.repository.js';
import { CategoriesService } from '../../categories/categories.service.js';
import { ProductsRepository } from '../products.repository.js';
import { ProductsService } from '../products.service.js';
import {
  describeDb,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db.js';

describeDb('ProductsService.findSellableCatalog', () => {
  let t: CatalogTestDb;
  let products: ProductsService;
  let categories: CategoriesService;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    const categoriesRepository = new CategoriesRepository();
    products = new ProductsService(t.db, new ProductsRepository(), categoriesRepository);
    categories = new CategoriesService(t.db, categoriesRepository);
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns only active products, live variants and live categories, for this merchant only', async () => {
    const kept = await categories.create(t.merchantA, { name: 'Sellable Kept', parentId: null });
    const removed = await categories.create(t.merchantA, {
      name: 'Sellable Removed',
      parentId: null,
    });

    const make = (name: string, status: 'draft' | 'active' | 'archived') =>
      products.create(
        t.merchantA,
        createProductSchema.parse({
          name,
          status,
          deliveryCharge: 0,
          categoryIds: [kept.id, removed.id],
          variants: [
            { name: 'M', price: 1000, stock: 1 },
            { name: 'L', price: 1000, stock: 0 },
          ],
        }),
      );

    const active = await make('Sellable Active', 'active');
    await make('Sellable Draft', 'draft');
    await make('Sellable Archived', 'archived');
    await products.create(
      t.merchantB,
      createProductSchema.parse({
        name: 'Other seller',
        status: 'active',
        deliveryCharge: 0,
        variants: [{ price: 1, stock: 1 }],
      }),
    );

    const archivedVariant = active.variants.find((v) => v.name === 'L');
    await products.archiveVariant(t.merchantA, active.id, archivedVariant!.id);
    await categories.remove(t.merchantA, removed.id);

    const catalog = await products.findSellableCatalog(t.merchantA);

    expect(catalog.products.map((p) => p.name)).toEqual(['Sellable Active']);
    const [only] = catalog.products;
    expect(only?.variants.map((v) => v.name)).toEqual(['M']);
    expect(only?.categoryIds).toEqual([kept.id]);
    expect(catalog.categories.map((c) => c.id)).toContain(kept.id);
    expect(catalog.categories.map((c) => c.id)).not.toContain(removed.id);
  });
});
