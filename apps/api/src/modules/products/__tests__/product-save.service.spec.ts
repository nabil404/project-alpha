import { createProductSchema, type Product, type SaveProduct } from '@app/shared';
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

describeDb('ProductsService — save', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  let n = 0;
  const sku = (label: string) => `SV-${label}-${++n}`;

  const plain = (merchantId = t.merchantA) =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Mug',
        deliveryCharge: 0,
        variants: [{ price: 50000, stock: 4 }],
      }),
    );
  const sized = (merchantId = t.merchantA, status: 'draft' | 'active' = 'draft') =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Kurti',
        status,
        deliveryCharge: 0,
        options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'L' }] }],
        variants: [
          { optionValues: ['M'], sku: sku('m'), price: 160000, stock: 9 },
          { optionValues: ['L'], sku: sku('l'), price: 160000, stock: 7 },
        ],
      }),
    );
  const save = (product: Product, change: (doc: SaveProduct) => void = () => {}) => {
    const doc = documentOf(product);
    change(doc);
    return service.save(t.merchantA, product.id, doc);
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('saves an unchanged document, changing nothing but the version', async () => {
    const product = await sized();
    const saved = await save(product);
    expect(saved.variants).toEqual(product.variants);
    expect(saved.options).toEqual(product.options);
    expect(saved.version).not.toBe(product.version);
  });

  it('adds an option, turning the default variant into a named one', async () => {
    const product = await plain();
    const saved = await save(product, (doc) => {
      doc.options = [{ name: 'Size', values: [{ value: 'S' }, { value: 'M' }] }];
      doc.variants[0]!.optionValues = ['S'];
      doc.variants.push({ optionValues: ['M'], price: 60000, stock: 1, imageId: null });
    });

    expect(saved.variants.map((v) => [v.name, v.isDefault])).toEqual([
      ['S', false],
      ['M', false],
    ]);
    expect(saved.variants[0]).toMatchObject({
      id: product.variants[0]!.id,
      sku: product.variants[0]!.sku,
      stock: 4,
    });
    expect(saved.variants[1]?.sku).toMatch(/^SKU-/);
  });

  it('renames a value, keeping the variant, its SKU and its stock', async () => {
    const product = await sized();
    const saved = await save(product, (doc) => {
      doc.options[0]!.values[0]!.value = 'Medium';
      doc.variants[0]!.optionValues = ['Medium'];
    });
    const before = product.variants[0]!;
    expect(saved.variants[0]).toMatchObject({
      id: before.id,
      name: 'Medium',
      sku: before.sku,
      stock: 9,
    });
    expect(saved.options[0]?.values[0]).toEqual({
      id: product.options[0]!.values[0]!.id,
      value: 'Medium',
    });
  });

  it('adds a second option, naming variants by both values in option order', async () => {
    const product = await sized();
    const saved = await save(product, (doc) => {
      doc.options.push({ name: 'Sleeve', values: [{ value: 'Short' }, { value: 'Long' }] });
      doc.variants[0]!.optionValues = ['M', 'Short'];
      doc.variants[1]!.optionValues = ['L', 'Short'];
      doc.variants.push({ optionValues: ['M', 'Long'], price: 160000, stock: 4, imageId: null });
    });
    // Sorted by value positions: M before L, Short before Long.
    expect(saved.variants.map((v) => v.name)).toEqual(['M / Short', 'M / Long', 'L / Short']);
    expect(saved.variants[0]?.optionValueIds).toEqual([
      saved.options[0]!.values[0]!.id,
      saved.options[1]!.values[0]!.id,
    ]);
  });

  it('removing a value archives its variants, frees their SKUs and hides them from the assistant', async () => {
    const product = await sized(t.merchantA, 'active');
    const large = product.variants[1]!;
    const saved = await save(product, (doc) => {
      doc.options[0]!.values = doc.options[0]!.values.filter((v) => v.value !== 'L');
      doc.variants = doc.variants.filter((v) => v.id !== large.id);
    });

    expect(saved.variants.map((v) => v.name)).toEqual(['M']);
    const catalog = await service.findSellableCatalog(t.merchantA);
    expect(catalog.products.find((p) => p.id === product.id)?.variants.map((v) => v.name)).toEqual([
      'M',
    ]);
    await expect(
      service.create(
        t.merchantA,
        createProductSchema.parse({
          name: 'Reuse',
          deliveryCharge: 0,
          variants: [{ sku: large.sku, price: 1 }],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('removing every option leaves one default variant', async () => {
    const product = await sized();
    const saved = await save(product, (doc) => {
      doc.options = [];
      doc.variants = [{ ...doc.variants[0]!, optionValues: [] }];
    });
    expect(saved.options).toEqual([]);
    expect(saved.variants).toHaveLength(1);
    expect(saved.variants[0]).toMatchObject({
      id: product.variants[0]!.id,
      name: null,
      isDefault: true,
      optionValueIds: [],
    });
  });

  it('reorders values, and the variants follow', async () => {
    const product = await sized();
    const saved = await save(product, (doc) => {
      doc.options[0]!.values.reverse();
    });
    expect(saved.options[0]?.values.map((v) => v.value)).toEqual(['L', 'M']);
    expect(saved.variants.map((v) => v.name)).toEqual(['L', 'M']);
  });

  it('refuses a save made from an older read, writing nothing', async () => {
    const product = await sized();
    await save(product, (doc) => {
      doc.name = 'First';
    });
    await expectCoded(
      save(product, (doc) => {
        doc.name = 'Second';
      }),
      'PRODUCT_STALE',
    );
    expect((await service.get(t.merchantA, product.id)).name).toBe('First');
  });

  it('lets exactly one of two concurrent saves from the same read win', async () => {
    const product = await sized();
    const results = await Promise.allSettled([
      save(product, (doc) => {
        doc.name = 'A';
      }),
      save(product, (doc) => {
        doc.name = 'B';
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect((rejected!.reason as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: 'PRODUCT_STALE',
    });
  });

  it("refuses an option or variant id that isn't this product's", async () => {
    const product = await sized();
    const other = await sized();
    await expectCoded(
      save(product, (doc) => {
        doc.options[0]!.id = other.options[0]!.id;
      }),
      'PRODUCT_OPTION_NOT_FOUND',
    );
    await expectCoded(
      save(product, (doc) => {
        doc.variants[0]!.id = other.variants[0]!.id;
      }),
      'VARIANT_NOT_FOUND',
    );
  });

  it('sets the cover to one of its own photos, or the first when null or not its own', async () => {
    const product = await sized();
    const [first, second] = await seedImages(t.db, t.merchantA, product.id, 2);
    const other = await seedProduct(t.db, t.merchantA);
    const [foreign] = await seedImages(t.db, t.merchantA, other.id, 1);

    const chosen = await save(product, (doc) => {
      doc.coverImageId = second!.id;
    });
    expect(chosen.coverImageId).toBe(second!.id);

    const defaulted = await save(chosen, (doc) => {
      doc.coverImageId = null;
    });
    expect(defaulted.coverImageId).toBe(first!.id);

    // Another product's photo is not this product's, so the first photo stays the cover.
    const refused = await save(defaulted, (doc) => {
      doc.coverImageId = foreign!.id;
    });
    expect(refused.coverImageId).toBe(first!.id);
  });

  it('sets and clears a variant image', async () => {
    const product = await sized();
    const [image] = await seedImages(t.db, t.merchantA, product.id, 1);
    const set = await save(product, (doc) => {
      doc.variants[0]!.imageId = image!.id;
    });
    expect(set.variants[0]?.imageId).toBe(image!.id);
    const cleared = await save(set, (doc) => {
      doc.variants[0]!.imageId = null;
    });
    expect(cleared.variants[0]?.imageId).toBeNull();
  });

  it('rejects a SKU another product uses', async () => {
    const product = await sized();
    const other = await sized();
    await expectCoded(
      save(product, (doc) => {
        doc.variants[0]!.sku = other.variants[0]!.sku;
      }),
      'SKU_TAKEN',
    );
  });

  it('swaps SKUs between two variants in one save', async () => {
    const product = await sized();
    const [m, l] = product.variants;
    const saved = await save(product, (doc) => {
      doc.variants[0]!.sku = l!.sku;
      doc.variants[1]!.sku = m!.sku;
    });
    expect(saved.variants.map((v) => [v.id, v.sku])).toEqual([
      [m!.id, l!.sku],
      [l!.id, m!.sku],
    ]);
  });

  it('gives a new variant the SKU a surviving variant gives up', async () => {
    const product = await sized();
    const [m, l] = product.variants;
    const saved = await save(product, (doc) => {
      doc.options[0]!.values.push({ value: 'XL' });
      doc.variants.unshift({
        optionValues: ['XL'],
        sku: l!.sku,
        price: 1,
        stock: 0,
        imageId: null,
      });
      doc.variants[2]!.sku = sku('l2');
    });
    expect(saved.variants.find((v) => v.name === 'XL')?.sku).toBe(l!.sku);
    expect(saved.variants.find((v) => v.id === m!.id)?.sku).toBe(m!.sku);
  });

  it("cannot save another merchant's product", async () => {
    const product = await sized(t.merchantB);
    await expectCoded(
      service.save(t.merchantA, product.id, documentOf(product)),
      'PRODUCT_NOT_FOUND',
    );
  });

  it('refuses an invalid document even past the schema', async () => {
    const product = await sized();
    const unchecked = { ...documentOf(product), options: [] } as SaveProduct;
    await expectCoded(service.save(t.merchantA, product.id, unchecked), 'VALIDATION_FAILED');
  });
});
