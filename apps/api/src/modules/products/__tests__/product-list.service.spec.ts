import { randomUUID } from 'node:crypto';
import {
  createProductSchema,
  listProductsQuerySchema,
  type ListProductsQuery,
  type Product,
} from '@app/shared';
import type { z } from 'zod';
import type { ProductsService } from '../products.service';
import { ProductsRepository } from '../products.repository';
import {
  describeDb,
  openCatalogTestDb,
  seedCategory,
  seedImage,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { productsService } from './products-service.fixture';

describeDb('ProductsService — list and counts', () => {
  let t: CatalogTestDb;
  let service: ProductsService;
  const made: Record<string, Product> = {};
  let categoryA: string;
  let categoryB: string;

  const create = async (
    key: string,
    input: Omit<z.input<typeof createProductSchema>, 'name' | 'deliveryCharge'>,
  ) => {
    made[key] = await service.create(
      t.merchantA,
      createProductSchema.parse({ name: key, deliveryCharge: 0, status: 'active', ...input }),
    );
  };
  const list = (query: Partial<Record<keyof ListProductsQuery, unknown>> = {}) =>
    service.list(t.merchantA, listProductsQuerySchema.parse(query));
  const names = async (query: Partial<Record<keyof ListProductsQuery, unknown>> = {}) =>
    (await list(query)).data.map((item) => item.name);

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = productsService(t.db);
    categoryA = (await seedCategory(t.db, t.merchantA)).id;
    categoryB = (await seedCategory(t.db, t.merchantA)).id;

    // Created oldest to newest; the list shows them the other way round.
    await create('Archived shawl', {
      status: 'archived',
      variants: [{ sku: 'SHAWL-1', price: 90000, stock: 3 }],
    });
    await create('Canvas tote', {
      status: 'draft',
      variants: [{ sku: 'TOTE-1', price: 85000, stock: 12 }],
    });
    await create('Jhumka', {
      options: [{ name: 'Colour', values: [{ value: 'Silver' }] }],
      variants: [{ optionValues: ['Silver'], sku: 'JHM-SLV', price: 45000, stock: 8 }],
    });
    await create('Hijab set', {
      aliases: ['scarf'],
      variants: [{ sku: 'HIJ-SET-01', price: 69000, stock: 40 }],
    });
    await create('Leather sandals', {
      options: [{ name: 'Size', values: [{ value: '38' }, { value: '39' }] }],
      variants: [
        { optionValues: ['38'], sku: 'SAN-38', price: 260000, stock: 0 },
        { optionValues: ['39'], sku: 'SAN-39', price: 260000, stock: 0 },
      ],
    });
    await create('Georgette saree', {
      categoryIds: [categoryA],
      options: [
        { name: 'Colour', values: [{ value: 'Maroon' }, { value: 'Teal' }, { value: 'Black' }] },
      ],
      variants: [
        { optionValues: ['Maroon'], sku: 'SAR-MAR', price: 350000, stock: 2 },
        { optionValues: ['Teal'], sku: 'SAR-TEA', price: 330000, stock: 1 },
        { optionValues: ['Black'], sku: 'SAR-BLK', price: 330000, stock: 0 },
      ],
    });
    await create('Blue kurti', {
      categoryIds: [categoryB],
      options: [
        { name: 'Size', values: [{ value: 'S' }, { value: 'M' }] },
        { name: 'Sleeve', values: [{ value: 'Short' }] },
      ],
      variants: [
        { optionValues: ['S', 'Short'], sku: 'KUR-S', price: 160000, stock: 4 },
        { optionValues: ['M', 'Short'], sku: 'KUR-M', price: 160000, stock: 9 },
      ],
    });
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists newest first and leaves archived products out of All', async () => {
    expect(await names()).toEqual([
      'Blue kurti',
      'Georgette saree',
      'Leather sandals',
      'Hijab set',
      'Jhumka',
      'Canvas tote',
    ]);
  });

  it('sums up each product over its live variants', async () => {
    const { data } = await list();
    const saree = data.find((item) => item.name === 'Georgette saree')!;
    expect(saree).toMatchObject({
      id: made['Georgette saree']!.id,
      status: 'active',
      categoryIds: [categoryA],
      optionNames: ['Colour'],
      variantCount: 3,
      priceMin: 330000,
      priceMax: 350000,
      stock: 3,
      lowVariantCount: 2,
      outVariantCount: 1,
      stockLevel: 'low_stock',
      coverThumbnailUrl: null,
      variant: null,
    });

    const kurti = data.find((item) => item.name === 'Blue kurti')!;
    expect(kurti).toMatchObject({ optionNames: ['Size', 'Sleeve'], stockLevel: 'low_stock' });
    expect(data.find((item) => item.name === 'Leather sandals')!.stockLevel).toBe('out_of_stock');
    expect(data.find((item) => item.name === 'Hijab set')!.stockLevel).toBe('in_stock');
  });

  it('carries a lone variant inline, named when it has option values', async () => {
    const { data } = await list();
    const hijab = data.find((item) => item.name === 'Hijab set')!;
    expect(hijab.variant).toEqual({
      id: made['Hijab set']!.variants[0]!.id,
      name: null,
      sku: 'HIJ-SET-01',
      price: 69000,
      stock: 40,
      stockLevel: 'in_stock',
      thumbnailUrl: null,
    });
    const jhumka = data.find((item) => item.name === 'Jhumka')!;
    expect(jhumka).toMatchObject({ optionNames: ['Colour'], variantCount: 1 });
    expect(jhumka.variant).toMatchObject({
      name: 'Silver',
      sku: 'JHM-SLV',
      stockLevel: 'in_stock',
    });
  });

  it('files every product under exactly one stock chip, and counts them the same way', async () => {
    expect(await names({ filter: 'in_stock' })).toEqual(['Hijab set', 'Jhumka', 'Canvas tote']);
    expect(await names({ filter: 'low_stock' })).toEqual(['Blue kurti', 'Georgette saree']);
    expect(await names({ filter: 'out_of_stock' })).toEqual(['Leather sandals']);
    expect(await names({ filter: 'draft' })).toEqual(['Canvas tote']);
    expect(await names({ filter: 'archived' })).toEqual(['Archived shawl']);

    expect(await service.counts(t.merchantA)).toEqual({
      all: 6,
      inStock: 3,
      lowStock: 2,
      outOfStock: 1,
      draft: 1,
      archived: 1,
    });
  });

  it('searches the name, the tags and live SKUs, case-insensitively', async () => {
    expect(await names({ q: 'SAREE' })).toEqual(['Georgette saree']);
    expect(await names({ q: 'scar' })).toEqual(['Hijab set']);
    expect(await names({ q: 'kur-m' })).toEqual(['Blue kurti']);
    expect(await names({ q: '%' })).toEqual([]);
  });

  it('filters by a category', async () => {
    expect(await names({ categoryId: categoryA })).toEqual(['Georgette saree']);
    expect(await names({ categoryId: categoryB })).toEqual(['Blue kurti']);
    expect(await names({ categoryId: randomUUID() })).toEqual([]);
  });

  it('pages through the list and reports the total', async () => {
    const all = await names();
    const second = await list({ page: 2, limit: 10 });
    expect(second.data).toEqual([]);
    expect(second.pagination).toEqual({ page: 2, limit: 10, total: 6, totalPages: 1 });

    const first = await list({ filter: 'all', limit: 10 });
    expect(first.data.map((item) => item.name)).toEqual(all);
    expect(first.pagination.total).toBe(6);
  });

  it("points the thumbnails at the cover, or the lone variant's own image", async () => {
    const hijab = made['Hijab set']!;
    const cover = await seedImage(t.db, t.merchantA, hijab.id);
    await new ProductsRepository().setCoverImage(
      t.db,
      { merchantId: t.merchantA },
      hijab.id,
      cover.id,
    );

    const item = (await list({ q: 'Hijab' })).data[0]!;
    expect(item.coverThumbnailUrl).toContain(cover.id);
    expect(item.variant?.thumbnailUrl).toBe(item.coverThumbnailUrl);
  });

  it("never lists or counts another merchant's products", async () => {
    const other = await service.list(t.merchantB, listProductsQuerySchema.parse({}));
    expect(other.data).toEqual([]);
    expect(other.pagination.total).toBe(0);
    expect(await service.counts(t.merchantB)).toEqual({
      all: 0,
      inStock: 0,
      lowStock: 0,
      outOfStock: 0,
      draft: 0,
      archived: 0,
    });
    expect(
      (await service.list(t.merchantB, listProductsQuerySchema.parse({ categoryId: categoryA })))
        .data,
    ).toEqual([]);
  });
});
