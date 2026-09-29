import { createProductSchema } from '@app/shared';
import { CategoriesRepository } from '../../categories/categories.repository';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { ProductImageRepository } from '../images/product-image.repository';
import { ProductsRepository } from '../products.repository';
import { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';

describeDb('ProductsService — variants', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  let n = 0;
  const sku = (label: string) => `P6-${label}-${++n}`;

  const simpleProduct = (merchantId: string) =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Mug',
        deliveryCharge: 0,
        variants: [{ price: 50000, stock: 4 }],
      }),
    );
  const sizedProduct = (merchantId: string) =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Shirt',
        deliveryCharge: 0,
        variants: [
          { name: 'M', price: 90000, stock: 1 },
          { name: 'L', price: 90000, stock: 1 },
        ],
      }),
    );

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

  describe('addVariant', () => {
    it('requires naming the default variant when adding a second', async () => {
      const product = await simpleProduct(t.merchantA);
      await expectCoded(
        service.addVariant(t.merchantA, product.id, { name: 'Large', price: 60000, stock: 1 }),
        'VARIANT_NAME_REQUIRED',
      );
    });

    it('names the default in the same call, which stops it being the default', async () => {
      const product = await simpleProduct(t.merchantA);
      const updated = await service.addVariant(t.merchantA, product.id, {
        name: 'Large',
        price: 60000,
        stock: 1,
        defaultVariantName: 'Regular',
      });
      expect(updated.variants.map((v) => v.name).sort()).toEqual(['Large', 'Regular']);
      expect(updated.variants.every((v) => !v.isDefault)).toBe(true);
    });

    it('adds to a product with named variants, generating a SKU when none is given', async () => {
      const product = await sizedProduct(t.merchantA);
      const updated = await service.addVariant(t.merchantA, product.id, {
        name: 'XL',
        price: 95000,
        stock: 2,
      });
      expect(updated.variants.find((v) => v.name === 'XL')?.sku).toMatch(/^SKU-/);
    });

    it('rejects a taken SKU', async () => {
      const taken = sku('add');
      const product = await sizedProduct(t.merchantA);
      await service.addVariant(t.merchantA, product.id, {
        name: 'XL',
        sku: taken,
        price: 1,
        stock: 1,
      });
      await expectCoded(
        service.addVariant(t.merchantA, product.id, {
          name: 'XXL',
          sku: taken.toLowerCase(),
          price: 1,
          stock: 1,
        }),
        'SKU_TAKEN',
      );
    });

    it("cannot add to another merchant's product", async () => {
      const product = await sizedProduct(t.merchantA);
      await expectCoded(
        service.addVariant(t.merchantB, product.id, { name: 'XL', price: 1, stock: 1 }),
        'PRODUCT_NOT_FOUND',
      );
    });
  });

  describe('updateVariant', () => {
    it('updates price, stock and SKU', async () => {
      const product = await sizedProduct(t.merchantA);
      const target = product.variants[0]!;
      const given = sku('upd');
      const updated = await service.updateVariant(t.merchantA, product.id, target.id, {
        price: 99000,
        stock: 0,
        sku: given.toLowerCase(),
      });
      expect(updated.variants.find((v) => v.id === target.id)).toMatchObject({
        price: 99000,
        stock: 0,
        stockStatus: 'out_of_stock',
        sku: given.toUpperCase(),
      });
    });

    it('returns the product unchanged when given no fields', async () => {
      const product = await sizedProduct(t.merchantA);
      await expect(
        service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, {}),
      ).resolves.toEqual(product);
    });

    it('refuses to unname a variant while others are live', async () => {
      const product = await sizedProduct(t.merchantA);
      await expectCoded(
        service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, { name: null }),
        'VARIANT_NAME_REQUIRED',
      );
    });

    it('unnaming the only live variant makes it the default, and naming it undoes that', async () => {
      const product = await sizedProduct(t.merchantA);
      const [keep, drop] = product.variants;
      await service.archiveVariant(t.merchantA, product.id, drop!.id);

      const unnamed = await service.updateVariant(t.merchantA, product.id, keep!.id, {
        name: null,
      });
      expect(unnamed.variants).toEqual([
        expect.objectContaining({ id: keep!.id, name: null, isDefault: true }),
      ]);

      const named = await service.updateVariant(t.merchantA, product.id, keep!.id, {
        name: 'One size',
      });
      expect(named.variants).toEqual([
        expect.objectContaining({ name: 'One size', isDefault: false }),
      ]);
    });

    it('rejects a SKU another live variant uses', async () => {
      const product = await sizedProduct(t.merchantA);
      const [m, l] = product.variants;
      await expectCoded(
        service.updateVariant(t.merchantA, product.id, l!.id, { sku: m!.sku }),
        'SKU_TAKEN',
      );
    });

    it("rejects a variant of a different product, and another merchant's product", async () => {
      const one = await sizedProduct(t.merchantA);
      const other = await sizedProduct(t.merchantA);
      await expectCoded(
        service.updateVariant(t.merchantA, one.id, other.variants[0]!.id, { stock: 9 }),
        'VARIANT_NOT_FOUND',
      );
      await expectCoded(
        service.updateVariant(t.merchantB, one.id, one.variants[0]!.id, { stock: 9 }),
        'PRODUCT_NOT_FOUND',
      );
    });
  });

  describe('archiveVariant', () => {
    it('refuses to archive the last live variant', async () => {
      const product = await simpleProduct(t.merchantA);
      await expectCoded(
        service.archiveVariant(t.merchantA, product.id, product.variants[0]!.id),
        'PRODUCT_NEEDS_VARIANT',
      );
    });

    it('hides an archived variant and frees its SKU', async () => {
      const product = await sizedProduct(t.merchantA);
      const [gone] = product.variants;
      const after = await service.archiveVariant(t.merchantA, product.id, gone!.id);
      expect(after.variants.map((v) => v.id)).not.toContain(gone!.id);

      const reused = await service.addVariant(t.merchantA, product.id, {
        name: 'M again',
        sku: gone!.sku,
        price: 1,
        stock: 1,
      });
      expect(reused.variants.map((v) => v.sku)).toContain(gone!.sku);
    });

    it('rejects an already archived variant', async () => {
      const product = await sizedProduct(t.merchantA);
      await service.addVariant(t.merchantA, product.id, { name: 'XL', price: 1, stock: 1 });
      const [first] = product.variants;
      await service.archiveVariant(t.merchantA, product.id, first!.id);
      await expectCoded(
        service.archiveVariant(t.merchantA, product.id, first!.id),
        'VARIANT_NOT_FOUND',
      );
    });

    it('lets exactly one of two concurrent archives of the last two variants succeed', async () => {
      const product = await sizedProduct(t.merchantA);
      const [m, l] = product.variants;

      const results = await Promise.allSettled([
        service.archiveVariant(t.merchantA, product.id, m!.id),
        service.archiveVariant(t.merchantA, product.id, l!.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      await expectCoded(
        Promise.reject((rejected as PromiseRejectedResult).reason),
        'PRODUCT_NEEDS_VARIANT',
      );
      await expect(service.get(t.merchantA, product.id)).resolves.toMatchObject({
        variants: [expect.anything()],
      });
    });

    it("cannot archive another merchant's variant", async () => {
      const product = await sizedProduct(t.merchantA);
      await expectCoded(
        service.archiveVariant(t.merchantB, product.id, product.variants[0]!.id),
        'PRODUCT_NOT_FOUND',
      );
    });
  });
});
