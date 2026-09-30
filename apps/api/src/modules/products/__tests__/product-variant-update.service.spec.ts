import { createProductSchema, type UpdateVariant } from '@app/shared';
import type { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  seedImages,
  seedProduct,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { documentOf, productsService } from './products-service.fixture';

describeDb('ProductsService — updateVariant', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  let n = 0;
  const sku = (label: string) => `UV-${label}-${++n}`;

  const sized = (merchantId = t.merchantA) =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Kurti',
        deliveryCharge: 0,
        options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'L' }] }],
        variants: [
          { optionValues: ['M'], sku: sku('m'), price: 160000, stock: 9 },
          { optionValues: ['L'], sku: sku('l'), price: 160000, stock: 7 },
        ],
      }),
    );

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('changes price, stock and a normalized SKU of one variant only', async () => {
    const product = await sized();
    const [m, l] = product.variants;
    const given = sku('new');

    const updated = await service.updateVariant(t.merchantA, product.id, m!.id, {
      price: 150000,
      stock: 3,
      sku: ` ${given.toLowerCase()} `,
    });

    expect(updated.variants[0]).toMatchObject({
      id: m!.id,
      name: 'M',
      price: 150000,
      stock: 3,
      sku: given.toUpperCase(),
      optionValueIds: m!.optionValueIds,
    });
    expect(updated.variants[1]).toEqual(l);
  });

  it("bumps the product's version, so an edit page holding the old one can't overwrite it", async () => {
    const product = await sized();
    const updated = await service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, {
      stock: 0,
    });
    expect(updated.version).not.toBe(product.version);
    await expectCoded(service.save(t.merchantA, product.id, documentOf(product)), 'PRODUCT_STALE');
  });

  it('leaves the product and its version alone when given no fields', async () => {
    const product = await sized();
    const same = await service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, {});
    expect(same).toEqual(product);
  });

  it("sets and clears one of the product's own images, and refuses another product's", async () => {
    const product = await sized();
    const variantId = product.variants[0]!.id;
    const [image] = await seedImages(t.db, t.merchantA, product.id, 1);
    const other = await seedProduct(t.db, t.merchantA);
    const [foreign] = await seedImages(t.db, t.merchantA, other.id, 1);

    const set = await service.updateVariant(t.merchantA, product.id, variantId, {
      imageId: image!.id,
    });
    expect(set.variants[0]?.imageId).toBe(image!.id);

    const cleared = await service.updateVariant(t.merchantA, product.id, variantId, {
      imageId: null,
    });
    expect(cleared.variants[0]?.imageId).toBeNull();

    await expectCoded(
      service.updateVariant(t.merchantA, product.id, variantId, { imageId: foreign!.id }),
      'PRODUCT_IMAGE_NOT_FOUND',
    );
  });

  it('rejects a SKU another live variant uses', async () => {
    const product = await sized();
    await expectCoded(
      service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, {
        sku: product.variants[1]!.sku,
      }),
      'SKU_TAKEN',
    );
  });

  it('refuses an archived variant, and a variant of another product', async () => {
    const product = await sized();
    const other = await sized();
    const large = product.variants[1]!;
    const doc = documentOf(product);
    doc.options[0]!.values.pop();
    doc.variants.pop();
    await service.save(t.merchantA, product.id, doc);

    await expectCoded(
      service.updateVariant(t.merchantA, product.id, large.id, { stock: 1 }),
      'VARIANT_NOT_FOUND',
    );
    await expectCoded(
      service.updateVariant(t.merchantA, product.id, other.variants[0]!.id, { stock: 1 }),
      'VARIANT_NOT_FOUND',
    );
  });

  it("cannot change another merchant's variant", async () => {
    const product = await sized(t.merchantB);
    await expectCoded(
      service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, { stock: 1 }),
      'PRODUCT_NOT_FOUND',
    );
  });

  it('refuses invalid fields even past the schema', async () => {
    const product = await sized();
    const unchecked = { stock: -1 } as UpdateVariant;
    await expectCoded(
      service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, unchecked),
      'VALIDATION_FAILED',
    );
  });
});
