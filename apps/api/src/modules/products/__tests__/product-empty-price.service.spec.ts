import { createProductSchema, type Product } from '@app/shared';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import type { ProductsService } from '../products.service';
import { documentOf, productsService } from './products-service.fixture';

describeDb('ProductsService — empty price and stock', () => {
  let t: CatalogTestDb;
  let service: ProductsService;

  const create = (
    status: 'draft' | 'active' | 'archived',
    price: number | null,
    stock: number | null,
  ) =>
    service.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Muslin', status, variants: [{ price, stock }] }),
    );
  const variantOf = (product: Product) => product.variants[0]!;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('saves a draft and an archived product with no price or stock', async () => {
    for (const status of ['draft', 'archived'] as const) {
      const product = await create(status, null, null);
      expect(variantOf(product)).toMatchObject({
        price: null,
        stock: null,
        available: 0,
        stockStatus: 'out_of_stock',
      });
    }
  });

  it('refuses an active product with no price, and one with no stock', async () => {
    await expectCoded(create('active', null, 4), 'PRODUCT_PRICE_MISSING');
    await expectCoded(create('active', 9900, null), 'PRODUCT_STOCK_MISSING');
  });

  it('activates a draft only once the save fills the gaps', async () => {
    const draft = await create('draft', null, null);
    const activate = (price: number | null, stock: number | null) => {
      const doc = documentOf(draft);
      doc.status = 'active';
      doc.variants[0]!.price = price;
      doc.variants[0]!.stock = stock;
      return service.save(t.merchantA, draft.id, doc);
    };
    await expectCoded(activate(null, 3), 'PRODUCT_PRICE_MISSING');
    await expectCoded(activate(9900, null), 'PRODUCT_STOCK_MISSING');
    await expect(activate(9900, 3)).resolves.toMatchObject({ status: 'active' });
  });

  it('checks the status change on PATCH, archived back to active included', async () => {
    const archived = await create('archived', null, 2);
    await expectCoded(
      service.update(t.merchantA, archived.id, { status: 'active' }),
      'PRODUCT_PRICE_MISSING',
    );
    const still = await service.get(t.merchantA, archived.id);
    expect(still.status).toBe('archived');

    await service.updateVariant(t.merchantA, archived.id, variantOf(still).id, { price: 5000 });
    await expect(
      service.update(t.merchantA, archived.id, { status: 'active' }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('refuses emptying a variant of an active product', async () => {
    const active = await create('active', 9900, 3);
    const variantId = variantOf(active).id;
    await expectCoded(
      service.updateVariant(t.merchantA, active.id, variantId, { price: null }),
      'PRODUCT_PRICE_MISSING',
    );
    await expectCoded(
      service.updateVariant(t.merchantA, active.id, variantId, { stock: null }),
      'PRODUCT_STOCK_MISSING',
    );
    expect(variantOf(await service.get(t.merchantA, active.id))).toMatchObject({
      price: 9900,
      stock: 3,
    });
  });

  it('archives a product with empty fields as it is', async () => {
    const draft = await create('draft', null, null);
    await expect(
      service.update(t.merchantA, draft.id, { status: 'archived' }),
    ).resolves.toMatchObject({ status: 'archived', variants: [{ price: null, stock: null }] });
  });

  it('lists an empty price and stock as empty, and as out of stock', async () => {
    const draft = await create('draft', null, null);
    const list = await service.list(t.merchantA, { filter: 'draft', page: 1, limit: 100 });
    const row = list.data.find((item) => item.id === draft.id)!;
    expect(row).toMatchObject({
      priceMin: null,
      priceMax: null,
      stockLevel: 'out_of_stock',
      variant: { price: null, stock: null, available: 0, stockLevel: 'out_of_stock' },
    });
  });

  it('never lets the assistant see a product with an empty price', async () => {
    const draft = await create('draft', null, null);
    const catalog = await service.findSellableCatalog(t.merchantA);
    expect(catalog.products.some((product) => product.id === draft.id)).toBe(false);
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        expect(variant.price).not.toBeNull();
        expect(variant.stock).not.toBeNull();
      }
    }
  });
});
