import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  seedImages,
  seedProduct,
  type CatalogTestDb,
} from '../../../../database/__tests__/catalog-test-db';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import { ProductsRepository } from '../../products.repository';
import { productImageKeys } from '../product-image-keys';
import { ProductImageRepository } from '../product-image.repository';
import { ProductImagesService } from '../product-images.service';

const jpeg = (width = 64, height = 48) =>
  sharp({ create: { width, height, channels: 3, background: '#3a6' } })
    .jpeg()
    .toBuffer();

/** The status and coded body of a rejected call. */
async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof HttpException)) throw error;
  return { status: error.getStatus(), code: (error.getResponse() as { code?: unknown }).code };
}

describeDb('ProductImagesService', () => {
  let t: CatalogTestDb;
  let storage: InMemoryObjectStorage;
  let service: ProductImagesService;
  let productA: string;
  const scopeA = () => ({ merchantId: t.merchantA });
  const scopeB = () => ({ merchantId: t.merchantB });

  const rowsOf = (productId: string) =>
    t.db.select().from(schema.productImage).where(eq(schema.productImage.productId, productId));

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  beforeEach(async () => {
    storage = new InMemoryObjectStorage();
    service = new ProductImagesService(
      t.db,
      new ProductsRepository(),
      new ProductImageRepository(),
      storage,
    );
    productA = (await seedProduct(t.db, t.merchantA)).id;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('upload', () => {
    it('stores the full image and thumbnail, then the row', async () => {
      const image = await service.upload(scopeA(), productA, await jpeg(64, 48));

      const keys = productImageKeys(t.merchantA, image.id);
      expect(image).toEqual({
        id: image.id,
        url: storage.publicUrl(keys.full),
        thumbnailUrl: storage.publicUrl(keys.thumbnail),
        position: 0,
        width: 64,
        height: 48,
      });
      expect([...storage.objects.keys()].sort()).toEqual([keys.full, keys.thumbnail].sort());
      for (const object of storage.objects.values()) {
        expect(object.options).toEqual({
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable',
        });
      }
      expect(await rowsOf(productA)).toHaveLength(1);
    });

    it('appends at the next position', async () => {
      await seedImages(t.db, t.merchantA, productA, 2);

      const image = await service.upload(scopeA(), productA, await jpeg());

      expect(image.position).toBe(2);
    });

    it("answers 404 for another merchant's product, exactly as for a missing one, and stores nothing", async () => {
      await expect(codeOf(service.upload(scopeB(), productA, await jpeg()))).resolves.toEqual({
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
      await expect(codeOf(service.upload(scopeA(), randomUUID(), await jpeg()))).resolves.toEqual({
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
      expect(storage.objects.size).toBe(0);
    });

    it('answers 409 at 8 images before storing anything', async () => {
      await seedImages(t.db, t.merchantA, productA, 8);

      await expect(codeOf(service.upload(scopeA(), productA, await jpeg()))).resolves.toEqual({
        status: 409,
        code: 'PRODUCT_IMAGE_LIMIT_REACHED',
      });
      expect(storage.objects.size).toBe(0);
    });

    it('lets exactly one of two racing uploads take the last slot, and cleans up after the other', async () => {
      await seedImages(t.db, t.merchantA, productA, 7);
      const file = await jpeg();

      const results = await Promise.allSettled([
        service.upload(scopeA(), productA, file),
        service.upload(scopeA(), productA, file),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(await codeOf(Promise.reject(rejected?.reason))).toEqual({
        status: 409,
        code: 'PRODUCT_IMAGE_LIMIT_REACHED',
      });
      expect(await rowsOf(productA)).toHaveLength(8);
      expect(storage.objects.size).toBe(2);
    });

    it('answers 503 and leaves neither objects nor a row when storage fails', async () => {
      storage.failPut = (key) => key.endsWith('-thumb.jpg');

      await expect(codeOf(service.upload(scopeA(), productA, await jpeg()))).resolves.toEqual({
        status: 503,
        code: 'STORAGE_UNAVAILABLE',
      });
      expect(storage.objects.size).toBe(0);
      expect(await rowsOf(productA)).toHaveLength(0);
    });

    it('removes both objects when the row cannot be written', async () => {
      // The product disappears between the pre-check and the insert.
      const originalPut = storage.put.bind(storage);
      storage.put = async (key, body, options) => {
        await originalPut(key, body, options);
        if (key.endsWith('-thumb.jpg')) {
          await t.db.delete(schema.product).where(eq(schema.product.id, productA));
        }
      };

      await expect(codeOf(service.upload(scopeA(), productA, await jpeg()))).resolves.toEqual({
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
      expect(storage.objects.size).toBe(0);
    });

    it('answers 415 for a GIF and 400 for bytes that are not an image', async () => {
      const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
        .gif()
        .toBuffer();

      await expect(codeOf(service.upload(scopeA(), productA, gif))).resolves.toEqual({
        status: 415,
        code: 'PRODUCT_IMAGE_UNSUPPORTED_TYPE',
      });
      await expect(
        codeOf(service.upload(scopeA(), productA, Buffer.from('hello'))),
      ).resolves.toEqual({ status: 400, code: 'PRODUCT_IMAGE_INVALID' });
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('delete', () => {
    it('removes the row, compacts positions and then deletes both objects', async () => {
      const first = await service.upload(scopeA(), productA, await jpeg());
      const second = await service.upload(scopeA(), productA, await jpeg());
      const third = await service.upload(scopeA(), productA, await jpeg());

      await service.delete(scopeA(), productA, second.id);

      const rows = (await rowsOf(productA)).sort((x, y) => x.position - y.position);
      expect(rows.map((row) => [row.id, row.position])).toEqual([
        [first.id, 0],
        [third.id, 1],
      ]);
      const deletedKeys = productImageKeys(t.merchantA, second.id);
      expect(storage.objects.has(deletedKeys.full)).toBe(false);
      expect(storage.objects.has(deletedKeys.thumbnail)).toBe(false);
      expect(storage.objects.size).toBe(4);
    });

    it('still succeeds when the object delete fails, leaving it to the sweep', async () => {
      const image = await service.upload(scopeA(), productA, await jpeg());
      storage.failDelete = () => true;

      await expect(service.delete(scopeA(), productA, image.id)).resolves.toBeUndefined();
      expect(await rowsOf(productA)).toHaveLength(0);
    });

    it("answers 404 for an unknown image and for another merchant's image", async () => {
      const image = await service.upload(scopeA(), productA, await jpeg());

      await expect(codeOf(service.delete(scopeA(), productA, randomUUID()))).resolves.toEqual({
        status: 404,
        code: 'PRODUCT_IMAGE_NOT_FOUND',
      });
      await expect(codeOf(service.delete(scopeB(), productA, image.id))).resolves.toEqual({
        status: 404,
        code: 'PRODUCT_IMAGE_NOT_FOUND',
      });
      expect(await rowsOf(productA)).toHaveLength(1);
    });
  });

  describe('reorder', () => {
    it('applies a permutation and returns the gallery in its new order', async () => {
      const seeded = await seedImages(t.db, t.merchantA, productA, 3);
      const order = [seeded[2]!.id, seeded[0]!.id, seeded[1]!.id];

      const images = await service.reorder(scopeA(), productA, order);

      expect(images.map((image) => [image.id, image.position])).toEqual(
        order.map((id, position) => [id, position]),
      );
    });

    it.each([
      ['a duplicated id', (ids: string[]) => [ids[0]!, ids[0]!, ids[2]!]],
      ['a missing id', (ids: string[]) => [ids[0]!, ids[1]!]],
      ['a foreign id', (ids: string[]) => [ids[0]!, ids[1]!, randomUUID()]],
    ])('answers 400 for %s and leaves positions alone', async (_label, mutate) => {
      const seeded = await seedImages(t.db, t.merchantA, productA, 3);
      const ids = seeded.map((row) => row.id);

      await expect(codeOf(service.reorder(scopeA(), productA, mutate(ids)))).resolves.toEqual({
        status: 400,
        code: 'PRODUCT_IMAGE_ORDER_MISMATCH',
      });
      const rows = (await rowsOf(productA)).sort((x, y) => x.position - y.position);
      expect(rows.map((row) => row.id)).toEqual(ids);
    });

    it("answers 404 for another merchant's product", async () => {
      const seeded = await seedImages(t.db, t.merchantA, productA, 2);

      await expect(
        codeOf(
          service.reorder(
            scopeB(),
            productA,
            seeded.map((row) => row.id),
          ),
        ),
      ).resolves.toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    });
  });
});
