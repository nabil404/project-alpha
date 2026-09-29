import { eq } from 'drizzle-orm';
import { createProductSchema, type CreateProduct } from '@app/shared';
import * as schema from '../../database/schema/index';
import { CategoriesRepository } from '../../categories/categories.repository';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { ProductImageRepository } from '../images/product-image.repository';
import { ProductsRepository } from '../products.repository';
import { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  seedCategory,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';

describeDb('ProductsService — products and category links', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  let n = 0;
  const sku = (label: string) => `P5-${label}-${++n}`;
  const input = (overrides: Partial<Record<keyof CreateProduct, unknown>> = {}): CreateProduct =>
    createProductSchema.parse({
      name: 'Cotton Panjabi',
      deliveryCharge: 6000,
      variants: [{ price: 150000, stock: 3 }],
      ...overrides,
    });

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = new ProductsService(
      t.db,
      new ProductsRepository(),
      new CategoriesRepository(),
      new ProductImageRepository(),
      new InMemoryObjectStorage(),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  describe('create', () => {
    it('makes a single unnamed variant the default, with a generated SKU, as a draft', async () => {
      const product = await service.create(t.merchantA, input());
      expect(product.status).toBe('draft');
      expect(product.variants).toHaveLength(1);
      expect(product.variants[0]).toMatchObject({
        name: null,
        isDefault: true,
        price: 150000,
        stock: 3,
        stockStatus: 'in_stock',
        imageId: null,
      });
      expect(product.variants[0]?.sku).toMatch(/^SKU-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(product.images).toEqual([]);
    });

    it('reports stock 0 as out of stock', async () => {
      const product = await service.create(
        t.merchantA,
        input({ variants: [{ price: 100, stock: 0 }] }),
      );
      expect(product.variants[0]?.stockStatus).toBe('out_of_stock');
    });

    it('stores named variants and normalizes a given SKU', async () => {
      const given = sku('m');
      const product = await service.create(
        t.merchantA,
        input({
          variants: [
            { name: 'M', sku: `  ${given.toLowerCase()} `, price: 150000, stock: 2 },
            { name: 'L', price: 155000, stock: 0 },
          ],
        }),
      );
      const m = product.variants.find((v) => v.name === 'M');
      expect(m).toMatchObject({ sku: given.toUpperCase(), isDefault: false });
      expect(product.variants.every((v) => !v.isDefault)).toBe(true);
    });

    it('requires names when there is more than one variant, even past the schema', async () => {
      const unchecked: CreateProduct = {
        ...input(),
        variants: [
          { name: null, sku: undefined, price: 1, stock: 1 },
          { name: 'L', sku: undefined, price: 1, stock: 1 },
        ],
      };
      await expectCoded(service.create(t.merchantA, unchecked), 'VARIANT_NAME_REQUIRED');
    });

    it("rejects a SKU another live variant of the merchant uses, but not another merchant's", async () => {
      const taken = sku('dup');
      await service.create(t.merchantA, input({ variants: [{ sku: taken, price: 1, stock: 1 }] }));
      await expectCoded(
        service.create(t.merchantA, input({ variants: [{ sku: taken, price: 1, stock: 1 }] })),
        'SKU_TAKEN',
      );
      await expect(
        service.create(t.merchantB, input({ variants: [{ sku: taken, price: 1, stock: 1 }] })),
      ).resolves.toBeDefined();
    });

    it('rejects two variants in one create sharing a SKU by case, leaving nothing behind', async () => {
      const name = `Dup case ${++n}`;
      const shared = sku('case');
      await expectCoded(
        service.create(
          t.merchantA,
          input({
            name,
            variants: [
              { name: 'M', sku: shared.toLowerCase(), price: 1, stock: 1 },
              { name: 'L', sku: shared.toUpperCase(), price: 1, stock: 1 },
            ],
          }),
        ),
        'SKU_TAKEN',
      );
      await expect(
        t.db.select().from(schema.product).where(eq(schema.product.name, name)),
      ).resolves.toHaveLength(0);
    });

    it('links live categories, deduplicating repeated ids', async () => {
      const cat = await seedCategory(t.db, t.merchantA);
      const product = await service.create(t.merchantA, input({ categoryIds: [cat.id, cat.id] }));
      expect(product.categoryIds).toEqual([cat.id]);
    });

    it("rejects a deleted or another merchant's category", async () => {
      const deleted = await seedCategory(t.db, t.merchantA, { deletedAt: new Date() });
      await expectCoded(
        service.create(t.merchantA, input({ categoryIds: [deleted.id] })),
        'CATEGORY_NOT_FOUND',
      );
      const ofB = await seedCategory(t.db, t.merchantB);
      await expectCoded(
        service.create(t.merchantA, input({ categoryIds: [ofB.id] })),
        'CATEGORY_NOT_FOUND',
      );
    });

    it('refuses a product with no variants, before any insert, even past the schema', async () => {
      const name = `No Variants ${++n}`;
      const unchecked: CreateProduct = { ...input({ name }), variants: [] };
      await expectCoded(service.create(t.merchantA, unchecked), 'PRODUCT_NEEDS_VARIANT');
      await expect(
        t.db.select().from(schema.product).where(eq(schema.product.name, name)),
      ).resolves.toHaveLength(0);
    });
  });

  describe('get, update, remove', () => {
    it("gets a product, but not another merchant's", async () => {
      const created = await service.create(t.merchantA, input());
      await expect(service.get(t.merchantA, created.id)).resolves.toEqual(created);
      await expectCoded(service.get(t.merchantB, created.id), 'PRODUCT_NOT_FOUND');
    });

    it('updates fields and replaces category links', async () => {
      const first = await seedCategory(t.db, t.merchantA);
      const second = await seedCategory(t.db, t.merchantA);
      const created = await service.create(t.merchantA, input({ categoryIds: [first.id] }));

      const updated = await service.update(t.merchantA, created.id, {
        name: 'Silk Panjabi',
        status: 'active',
        aliases: ['silk'],
        deliveryCharge: 8000,
        categoryIds: [second.id],
      });

      expect(updated).toMatchObject({
        name: 'Silk Panjabi',
        status: 'active',
        aliases: ['silk'],
        deliveryCharge: 8000,
        categoryIds: [second.id],
      });
    });

    it('returns the product unchanged when given no fields', async () => {
      const created = await service.create(t.merchantA, input());
      await expect(service.update(t.merchantA, created.id, {})).resolves.toEqual(created);
    });

    it('clears category links with an empty list', async () => {
      const cat = await seedCategory(t.db, t.merchantA);
      const created = await service.create(t.merchantA, input({ categoryIds: [cat.id] }));
      await expect(
        service.update(t.merchantA, created.id, { categoryIds: [] }),
      ).resolves.toMatchObject({
        categoryIds: [],
      });
    });

    it("cannot update or remove another merchant's product", async () => {
      const created = await service.create(t.merchantA, input());
      await expectCoded(
        service.update(t.merchantB, created.id, { name: 'Taken' }),
        'PRODUCT_NOT_FOUND',
      );
      await expectCoded(service.remove(t.merchantB, created.id), 'PRODUCT_NOT_FOUND');
      await expect(service.get(t.merchantA, created.id)).resolves.toMatchObject({
        name: 'Cotton Panjabi',
      });
    });

    it('removes a product with its variants', async () => {
      const created = await service.create(t.merchantA, input());
      await service.remove(t.merchantA, created.id);
      await expectCoded(service.get(t.merchantA, created.id), 'PRODUCT_NOT_FOUND');
      await expect(
        t.db
          .select()
          .from(schema.productVariant)
          .where(eq(schema.productVariant.productId, created.id)),
      ).resolves.toHaveLength(0);
    });
  });
});
