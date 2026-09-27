import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../../../database/base.repository.js';
import * as schema from '../../../../database/schema/index.js';
import { withMerchant } from '../../../../database/with-merchant.js';
import {
  describeDb,
  openCatalogTestDb,
  pgErrorOf,
  seedImages,
  seedProduct,
  type CatalogTestDb,
} from '../../../../database/__tests__/catalog-test-db.js';
import { productImageKeys } from '../product-image-keys.js';
import { ProductImageRepository } from '../product-image.repository.js';

// Runs as app_runtime so row-level security applies exactly as in production;
// every call also passes a scope, so each test proves the filter, not the policy.
describeDb('ProductImageRepository (app_runtime, two merchants)', () => {
  const repository = new ProductImageRepository();
  let t: CatalogTestDb;

  const as = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });
  const positionsOf = async (productId: string) =>
    (
      await t.db
        .select({ id: schema.productImage.id, position: schema.productImage.position })
        .from(schema.productImage)
        .where(eq(schema.productImage.productId, productId))
    ).sort((x, y) => x.position - y.position);
  const newImage = (merchantId: string, productId: string) => {
    const id = randomUUID();
    return {
      id,
      productId,
      storageKey: productImageKeys(merchantId, id).full,
      position: 0,
      width: 10,
      height: 20,
      byteSize: 300,
    };
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  it("lists products' images cover first, for this merchant only", async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const seeded = await seedImages(t.db, t.merchantA, product.id, 3);
    const scopeA = { merchantId: t.merchantA };
    const scopeB = { merchantId: t.merchantB };

    const listed = await as(t.merchantA, (tx) =>
      repository.listForProducts(tx, scopeA, [product.id]),
    );
    expect(listed.map((row) => row.id)).toEqual(seeded.map((row) => row.id));
    await expect(
      as(t.merchantB, (tx) => repository.listForProducts(tx, scopeB, [product.id])),
    ).resolves.toEqual([]);
    await expect(
      as(t.merchantA, (tx) => repository.listForProducts(tx, scopeA, [])),
    ).resolves.toEqual([]);
  });

  it('counts a product’s images, zero for another merchant', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    await seedImages(t.db, t.merchantA, product.id, 2);

    await expect(
      as(t.merchantA, (tx) => repository.count(tx, { merchantId: t.merchantA }, product.id)),
    ).resolves.toBe(2);
    await expect(
      as(t.merchantB, (tx) => repository.count(tx, { merchantId: t.merchantB }, product.id)),
    ).resolves.toBe(0);
  });

  it('inserts under the merchant’s scope', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const values = newImage(t.merchantA, product.id);

    const row = await as(t.merchantA, (tx) =>
      repository.insert(tx, { merchantId: t.merchantA }, values),
    );

    expect(row).toMatchObject({ id: values.id, merchantId: t.merchantA, productId: product.id });
  });

  it('is stopped by row-level security when the scope and the context disagree', async () => {
    const product = await seedProduct(t.db, t.merchantA);

    await expect(
      pgErrorOf(
        as(t.merchantB, (tx) =>
          repository.insert(tx, { merchantId: t.merchantA }, newImage(t.merchantA, product.id)),
        ),
      ),
    ).resolves.toMatchObject({ code: '42501' });
  });

  it('deletes one image and returns it, never another merchant’s', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const [image] = await seedImages(t.db, t.merchantA, product.id, 1);

    await expect(
      as(t.merchantB, (tx) =>
        repository.delete(tx, { merchantId: t.merchantB }, product.id, image!.id),
      ),
    ).resolves.toBeNull();
    expect(await positionsOf(product.id)).toHaveLength(1);

    await expect(
      as(t.merchantA, (tx) =>
        repository.delete(tx, { merchantId: t.merchantA }, product.id, image!.id),
      ),
    ).resolves.toMatchObject({ id: image!.id });
    expect(await positionsOf(product.id)).toHaveLength(0);
  });

  it('rewrites positions to the given order, never another merchant’s', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const seeded = await seedImages(t.db, t.merchantA, product.id, 3);
    const order = [seeded[2]!.id, seeded[0]!.id, seeded[1]!.id];

    await as(t.merchantB, (tx) =>
      repository.setPositions(tx, { merchantId: t.merchantB }, product.id, order),
    );
    expect((await positionsOf(product.id)).map((row) => row.id)).toEqual(
      seeded.map((row) => row.id),
    );

    await as(t.merchantA, (tx) =>
      repository.setPositions(tx, { merchantId: t.merchantA }, product.id, order),
    );
    expect(await positionsOf(product.id)).toEqual(order.map((id, position) => ({ id, position })));
  });

  it('reports which image ids still exist, for this merchant only', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const [kept] = await seedImages(t.db, t.merchantA, product.id, 1);

    await expect(
      as(t.merchantA, (tx) =>
        repository.existingIds(tx, { merchantId: t.merchantA }, [kept!.id, randomUUID()]),
      ),
    ).resolves.toEqual(new Set([kept!.id]));
    await expect(
      as(t.merchantB, (tx) => repository.existingIds(tx, { merchantId: t.merchantB }, [kept!.id])),
    ).resolves.toEqual(new Set());
  });
});
