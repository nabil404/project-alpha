import { createProductSchema } from '@app/shared';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { productImageKeys } from '../images/product-image-keys';
import type { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  seedImages,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { productsService } from './products-service.fixture';

// How the catalog's own operations treat a product's images.
describeDb('ProductsService — images', () => {
  let t: CatalogTestDb;
  let storage: InMemoryObjectStorage;
  let service: ProductsService;

  const shirt = (merchantId: string) =>
    service.create(
      merchantId,
      createProductSchema.parse({
        name: 'Shirt',
        options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'L' }] }],
        variants: [
          { optionValues: ['M'], price: 90000, stock: 1 },
          { optionValues: ['L'], price: 90000, stock: 1 },
        ],
      }),
    );

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  beforeEach(() => {
    storage = new InMemoryObjectStorage();
    service = productsService(t.db, storage);
  });

  afterAll(async () => {
    await t.close();
  });

  it('embeds the gallery cover first, with public URLs', async () => {
    const product = await shirt(t.merchantA);
    const [cover, second] = await seedImages(t.db, t.merchantA, product.id, 2);

    const read = await service.get(t.merchantA, product.id);

    const keys = productImageKeys(t.merchantA, cover!.id);
    expect(read.images.map((image) => image.id)).toEqual([cover!.id, second!.id]);
    expect(read.images[0]).toEqual({
      id: cover!.id,
      url: storage.publicUrl(keys.full),
      thumbnailUrl: storage.publicUrl(keys.thumbnail),
      position: 0,
      width: 100,
      height: 100,
    });
  });

  it("embeds each active product's gallery in the sellable catalog", async () => {
    const product = await shirt(t.merchantA);
    await service.update(t.merchantA, product.id, { status: 'active' });
    const [image] = await seedImages(t.db, t.merchantA, product.id, 1);

    const catalog = await service.findSellableCatalog(t.merchantA);

    const listed = catalog.products.find((p) => p.id === product.id);
    expect(listed?.images.map((i) => i.id)).toEqual([image!.id]);
  });

  describe('remove', () => {
    it("deletes the product's objects after the rows are gone", async () => {
      const product = await shirt(t.merchantA);
      const [image] = await seedImages(t.db, t.merchantA, product.id, 1);
      const keys = productImageKeys(t.merchantA, image!.id);
      storage.seed(keys.full, new Date());
      storage.seed(keys.thumbnail, new Date());

      await service.remove(t.merchantA, product.id);

      expect(storage.objects.size).toBe(0);
    });

    it('still removes the product when the object delete fails', async () => {
      const product = await shirt(t.merchantA);
      await seedImages(t.db, t.merchantA, product.id, 1);
      storage.failDelete = () => true;

      await expect(service.remove(t.merchantA, product.id)).resolves.toBeUndefined();
      await expectCoded(service.get(t.merchantA, product.id), 'PRODUCT_NOT_FOUND');
    });
  });
});
