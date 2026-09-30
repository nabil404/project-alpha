import { createProductSchema } from '@app/shared';
import sharp from 'sharp';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import {
  describeDb,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { documentOf, productsService } from '../../__tests__/products-service.fixture';
import { ProductsRepository } from '../../products.repository';
import type { ProductsService } from '../../products.service';
import { ProductImageRepository } from '../product-image.repository';
import { ProductImagesService } from '../product-images.service';

describeDb('ProductImagesService — the cover', () => {
  let t: CatalogTestDb;
  let products: ProductsService;
  let images: ProductImagesService;
  const jpeg = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: '#48c' } })
      .jpeg()
      .toBuffer();

  beforeAll(async () => {
    t = await openCatalogTestDb();
    const storage = new InMemoryObjectStorage();
    products = productsService(t.db, storage);
    images = new ProductImagesService(
      t.db,
      new ProductsRepository(),
      new ProductImageRepository(),
      storage,
    );
  });

  afterAll(async () => {
    await t.close();
  });

  const product = () =>
    products.create(
      t.merchantA,
      createProductSchema.parse({ name: 'Kurti', deliveryCharge: 0, variants: [{ price: 1 }] }),
    );
  const scope = () => ({ merchantId: t.merchantA });

  it('makes the first upload the cover and keeps it through later uploads', async () => {
    const { id } = await product();
    const first = await images.upload(scope(), id, await jpeg());
    await images.upload(scope(), id, await jpeg());
    expect((await products.get(t.merchantA, id)).coverImageId).toBe(first.id);
  });

  it('keeps the cover through a reorder', async () => {
    const { id } = await product();
    const first = await images.upload(scope(), id, await jpeg());
    const second = await images.upload(scope(), id, await jpeg());
    await images.reorder(scope(), id, [second.id, first.id]);
    const read = await products.get(t.merchantA, id);
    expect(read.coverImageId).toBe(first.id);
    expect(read.images.map((image) => image.id)).toEqual([second.id, first.id]);
  });

  it('promotes the first remaining photo when the cover is deleted, and clears it with the last', async () => {
    const { id } = await product();
    const first = await images.upload(scope(), id, await jpeg());
    const second = await images.upload(scope(), id, await jpeg());
    const third = await images.upload(scope(), id, await jpeg());
    await images.reorder(scope(), id, [third.id, first.id, second.id]);

    await images.delete(scope(), id, first.id);
    let read = await products.get(t.merchantA, id);
    expect(read.coverImageId).toBe(third.id);
    expect(read.images.map((image) => image.id)).toEqual([third.id, second.id]);

    await images.delete(scope(), id, third.id);
    await images.delete(scope(), id, second.id);
    read = await products.get(t.merchantA, id);
    expect(read.coverImageId).toBeNull();
  });

  it("doesn't make the edit page's pending save stale", async () => {
    const created = await product();
    const upload = await images.upload(scope(), created.id, await jpeg());
    await images.upload(scope(), created.id, await jpeg());
    await images.delete(scope(), created.id, upload.id);
    expect((await products.get(t.merchantA, created.id)).version).toBe(created.version);
  });

  it('still saves a page that read photos deleted since, falling back to the cover', async () => {
    const created = await product();
    const first = await images.upload(scope(), created.id, await jpeg());
    const second = await images.upload(scope(), created.id, await jpeg());
    const read = await products.get(t.merchantA, created.id);
    const doc = documentOf(read);
    doc.variants[0]!.imageId = second.id;

    await images.delete(scope(), created.id, first.id);
    await images.delete(scope(), created.id, second.id);
    const third = await images.upload(scope(), created.id, await jpeg());

    const saved = await products.save(t.merchantA, created.id, doc);
    expect(saved.coverImageId).toBe(third.id);
    expect(saved.variants[0]?.imageId).toBeNull();
  });
});
