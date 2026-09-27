import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../base.repository';
import * as schema from '../schema/index';
import { withMerchant } from '../with-merchant';
import {
  describeDb,
  openCatalogTestDb,
  pgErrorOf,
  seedImage,
  seedProduct,
  type CatalogTestDb,
} from './catalog-test-db';

// The test connection is a superuser, which ignores every policy. SET LOCAL
// ROLE drops to the runtime role for one transaction, which is how the api and
// worker actually connect.
describeDb('catalog row-level security (as app_runtime)', () => {
  let t: CatalogTestDb;

  const asRuntime = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  it('shows a merchant its own product and hides it from another merchant', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const byId = eq(schema.product.id, product.id);

    await expect(
      asRuntime(t.merchantA, (tx) => tx.select().from(schema.product).where(byId)),
    ).resolves.toHaveLength(1);
    await expect(
      asRuntime(t.merchantB, (tx) => tx.select().from(schema.product).where(byId)),
    ).resolves.toHaveLength(0);
  });

  it('shows nothing when no merchant context is set', async () => {
    await seedProduct(t.db, t.merchantA);
    const rows = await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return tx.select().from(schema.product);
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses to write a row for another merchant', async () => {
    await expect(
      pgErrorOf(
        asRuntime(t.merchantB, (tx) =>
          tx.insert(schema.category).values({ merchantId: t.merchantA, name: 'Smuggled' }),
        ),
      ),
    ).resolves.toMatchObject({ code: '42501' });
  });

  it("hides a merchant's product images from another merchant", async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const image = await seedImage(t.db, t.merchantA, product.id);
    const byId = eq(schema.productImage.id, image.id);

    await expect(
      asRuntime(t.merchantA, (tx) => tx.select().from(schema.productImage).where(byId)),
    ).resolves.toHaveLength(1);
    await expect(
      asRuntime(t.merchantB, (tx) => tx.select().from(schema.productImage).where(byId)),
    ).resolves.toHaveLength(0);
    await expect(
      asRuntime(t.merchantB, (tx) => tx.delete(schema.productImage).where(byId).returning()),
    ).resolves.toHaveLength(0);
  });
});
