import { createProductSchema } from '@app/shared';
import { CategoriesRepository } from '../../categories/categories.repository';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { productImageKeys } from '../images/product-image-keys';
import { ProductImageRepository } from '../images/product-image.repository';
import { ProductsRepository } from '../products.repository';
import { ProductsService } from '../products.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  seedImages,
  seedProduct,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';

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
        deliveryCharge: 0,
        variants: [
          { name: 'M', price: 90000, stock: 1 },
          { name: 'L', price: 90000, stock: 1 },
        ],
      }),
    );

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  beforeEach(() => {
    storage = new InMemoryObjectStorage();
    service = new ProductsService(
      t.db,
      new ProductsRepository(),
      new CategoriesRepository(),
      new ProductImageRepository(),
      storage,
    );
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

  describe('a variant image', () => {
    it("sets and clears one of the product's own images", async () => {
      const product = await shirt(t.merchantA);
      const [image] = await seedImages(t.db, t.merchantA, product.id, 1);
      const variantId = product.variants[0]!.id;

      const set = await service.updateVariant(t.merchantA, product.id, variantId, {
        imageId: image!.id,
      });
      expect(set.variants.find((v) => v.id === variantId)?.imageId).toBe(image!.id);

      const cleared = await service.updateVariant(t.merchantA, product.id, variantId, {
        imageId: null,
      });
      expect(cleared.variants.find((v) => v.id === variantId)?.imageId).toBeNull();
    });

    it("refuses another product's image, even the same merchant's", async () => {
      const product = await shirt(t.merchantA);
      const other = await seedProduct(t.db, t.merchantA);
      const [foreign] = await seedImages(t.db, t.merchantA, other.id, 1);

      await expectCoded(
        service.updateVariant(t.merchantA, product.id, product.variants[0]!.id, {
          imageId: foreign!.id,
        }),
        'PRODUCT_IMAGE_NOT_FOUND',
      );
    });
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
