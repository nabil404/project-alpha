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
import { product, productPost } from '../../../database/schema/index';
import { withMerchant } from '../../../database/with-merchant';
import { ProductPostRepository, type PostDetails } from '../product-post.repository';

describeDb('ProductPostRepository (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  const repo = new ProductPostRepository();

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

  const post = (overrides: Partial<PostDetails> = {}): PostDetails => ({
    postId: String(Math.floor(Math.random() * 1e15)),
    aliasId: `pfbid${randomUUID().replaceAll('-', '')}`,
    url: 'https://www.facebook.com/shop/posts/1',
    caption: 'Jamdani saree, new stock',
    ...overrides,
  });

  it('finds a post by either of its ids, linked rows first', async () => {
    const scope = { merchantId: t.merchantA };
    const p = await seedProduct(t.db, t.merchantA, { name: 'Jamdani Saree' });
    const linked = post();
    await as(t.merchantA, (tx) => repo.insertLinked(tx, scope, p.id, linked));

    for (const key of [linked.postId, linked.aliasId!]) {
      const [found] = await as(t.merchantA, (tx) => repo.findByKeys(tx, scope, [key]));
      expect(found).toMatchObject({
        productId: p.id,
        productName: 'Jamdani Saree',
        status: 'linked',
      });
    }
    expect(await as(t.merchantA, (tx) => repo.findByKeys(tx, scope, []))).toEqual([]);
  });

  it('keeps an existing row when the assistant suggests the same post again', async () => {
    const scope = { merchantId: t.merchantA };
    const mine = await seedProduct(t.db, t.merchantA);
    const other = await seedProduct(t.db, t.merchantA);
    const linked = post();
    await as(t.merchantA, (tx) => repo.insertLinked(tx, scope, mine.id, linked));

    expect(await as(t.merchantA, (tx) => repo.suggest(tx, scope, other.id, linked))).toBe(false);
    const [row] = await as(t.merchantA, (tx) => repo.findByKeys(tx, scope, [linked.postId]));
    expect(row).toMatchObject({ productId: mine.id, status: 'linked' });
  });

  it('turns a suggestion into a link, keeping what it knew', async () => {
    const scope = { merchantId: t.merchantA };
    const p = await seedProduct(t.db, t.merchantA);
    const suggested = post();
    await as(t.merchantA, (tx) => repo.suggest(tx, scope, p.id, suggested));
    const [row] = await as(t.merchantA, (tx) => repo.listForProduct(tx, scope, p.id));

    const linked = await as(t.merchantA, (tx) =>
      repo.relink(tx, scope, row!.id, p.id, { ...suggested, aliasId: null, caption: null }),
    );
    expect(linked).toMatchObject({
      status: 'linked',
      aliasId: suggested.aliasId,
      caption: suggested.caption,
    });
  });

  it("never lists, finds, matches, relinks or deletes another shop's posts", async () => {
    const theirProduct = await seedProduct(t.db, t.merchantB);
    const scopeB = { merchantId: t.merchantB };
    const theirs = post();
    const row = await as(t.merchantB, (tx) =>
      repo.insertLinked(tx, scopeB, theirProduct.id, theirs),
    );
    const scopeA = { merchantId: t.merchantA };
    const mine = await seedProduct(t.db, t.merchantA);

    expect(await as(t.merchantA, (tx) => repo.listForProduct(tx, scopeA, theirProduct.id))).toEqual(
      [],
    );
    expect(
      await as(t.merchantA, (tx) => repo.find(tx, scopeA, theirProduct.id, row.id)),
    ).toBeNull();
    expect(
      await as(t.merchantA, (tx) => repo.findByKeys(tx, scopeA, [theirs.postId, theirs.aliasId!])),
    ).toEqual([]);
    expect(
      await as(t.merchantA, (tx) => repo.relink(tx, scopeA, row.id, mine.id, theirs)),
    ).toBeNull();
    expect(await as(t.merchantA, (tx) => repo.delete(tx, scopeA, theirProduct.id, row.id))).toBe(
      false,
    );

    // The same post id in A's shop is A's own row, not a clash with B's.
    expect(await as(t.merchantA, (tx) => repo.suggest(tx, scopeA, mine.id, theirs))).toBe(true);
    const [still] = await t.db.select().from(productPost).where(eq(productPost.id, row.id));
    expect(still).toMatchObject({ merchantId: t.merchantB, productId: theirProduct.id });
  });

  it("refuses a link to another shop's product", async () => {
    const theirProduct = await seedProduct(t.db, t.merchantB);
    const error = await pgErrorOf(
      as(t.merchantA, (tx) =>
        repo.insertLinked(tx, { merchantId: t.merchantA }, theirProduct.id, post()),
      ),
    );
    expect(error.code).toBe('23503');
  });

  it('deletes the links with their product', async () => {
    const scope = { merchantId: t.merchantA };
    const p = await seedProduct(t.db, t.merchantA);
    const row = await as(t.merchantA, (tx) => repo.insertLinked(tx, scope, p.id, post()));

    await t.db.delete(product).where(eq(product.id, p.id));

    expect(await t.db.select().from(productPost).where(eq(productPost.id, row.id))).toEqual([]);
  });
});
