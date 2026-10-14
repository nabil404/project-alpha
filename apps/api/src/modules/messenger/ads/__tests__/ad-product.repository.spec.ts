import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  seedProduct,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { randomPageId } from '../../../database/__tests__/conversation-seeds';
import { adProduct, product } from '../../../database/schema/index';
import { withMerchant } from '../../../database/with-merchant';
import { AdProductRepository } from '../ad-product.repository';

describeDb('AdProductRepository (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  const repo = new AdProductRepository();

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  const as = <T>(merchantId: string, fn: Parameters<typeof withMerchant<T>>[2]) =>
    withMerchant(runtime.db, merchantId, fn);

  it('records a new ad unmapped, then counts each chat', async () => {
    const adId = `ad-${randomUUID()}`;
    const scope = { merchantId: t.merchantA };
    const pageId = randomPageId();
    const first = new Date('2026-10-11T08:00:00Z');
    const later = new Date('2026-10-12T09:00:00Z');

    expect(
      await as(t.merchantA, (tx) => repo.recordSeen(tx, scope, { pageId, adId, at: first })),
    ).toBeNull();
    await as(t.merchantA, (tx) => repo.recordSeen(tx, scope, { pageId, adId, at: later }));

    const rows = await as(t.merchantA, (tx) => repo.list(tx, scope));
    expect(rows.find((row) => row.adId === adId)).toMatchObject({
      chatCount: 2,
      firstSeenAt: first,
      lastSeenAt: later,
      productId: null,
      productName: null,
    });
  });

  it('returns the mapped product once the seller sets one', async () => {
    const scope = { merchantId: t.merchantA };
    const p = await seedProduct(t.db, t.merchantA, { name: 'Blue kurti' });
    const adId = `ad-${randomUUID()}`;
    const at = new Date();
    await as(t.merchantA, (tx) => repo.recordSeen(tx, scope, { pageId: randomPageId(), adId, at }));
    const row = (await as(t.merchantA, (tx) => repo.list(tx, scope))).find((r) => r.adId === adId)!;

    expect(await as(t.merchantA, (tx) => repo.setProduct(tx, scope, row.id, p.id))).toBe(true);
    expect(
      await as(t.merchantA, (tx) => repo.recordSeen(tx, scope, { pageId: row.pageId, adId, at })),
    ).toBe(p.id);
  });

  it("never lists, finds or maps another shop's ads", async () => {
    const adId = `ad-${randomUUID()}`;
    await as(t.merchantB, (tx) =>
      repo.recordSeen(
        tx,
        { merchantId: t.merchantB },
        { pageId: randomPageId(), adId, at: new Date() },
      ),
    );
    const theirs = (await as(t.merchantB, (tx) => repo.list(tx, { merchantId: t.merchantB }))).find(
      (row) => row.adId === adId,
    )!;
    const scopeA = { merchantId: t.merchantA };

    expect(
      (await as(t.merchantA, (tx) => repo.list(tx, scopeA))).some((r) => r.adId === adId),
    ).toBe(false);
    expect(await as(t.merchantA, (tx) => repo.find(tx, scopeA, theirs.id))).toBeNull();
    expect(await as(t.merchantA, (tx) => repo.setProduct(tx, scopeA, theirs.id, null))).toBe(false);
  });

  it('keeps the ad with a null product when the mapped product is deleted', async () => {
    const scope = { merchantId: t.merchantA };
    const p = await seedProduct(t.db, t.merchantA);
    const adId = `ad-${randomUUID()}`;
    await as(t.merchantA, (tx) =>
      repo.recordSeen(tx, scope, { pageId: randomPageId(), adId, at: new Date() }),
    );
    const row = (await as(t.merchantA, (tx) => repo.list(tx, scope))).find((r) => r.adId === adId)!;
    await as(t.merchantA, (tx) => repo.setProduct(tx, scope, row.id, p.id));

    await t.db.delete(product).where(eq(product.id, p.id));

    const [after] = await t.db.select().from(adProduct).where(eq(adProduct.id, row.id));
    expect(after).toMatchObject({ adId, productId: null });
    expect(after?.merchantId).toBe(t.merchantA);
  });

  it("refuses to map an ad to another shop's product", async () => {
    const scope = { merchantId: t.merchantA };
    const theirProduct = await seedProduct(t.db, t.merchantB);
    const adId = `ad-${randomUUID()}`;
    await as(t.merchantA, (tx) =>
      repo.recordSeen(tx, scope, { pageId: randomPageId(), adId, at: new Date() }),
    );
    const row = (await as(t.merchantA, (tx) => repo.list(tx, scope))).find((r) => r.adId === adId)!;

    const error = await pgErrorOf(
      as(t.merchantA, (tx) => repo.setProduct(tx, scope, row.id, theirProduct.id)),
    );
    expect(error.code).toBe('23503');
    const after = await as(t.merchantA, (tx) => repo.find(tx, scope, row.id));
    expect(after?.productId).toBeNull();
  });
});
