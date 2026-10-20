import { eq } from 'drizzle-orm';
import { importPostResults, importRunStatuses, importSources } from '@app/shared';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import * as schema from '../../database/schema/index';
import {
  IMPORT_POST_RESULT_VALUES,
  IMPORT_SOURCE_VALUES,
  IMPORT_STATUS_VALUES,
  PRODUCT_IMPORT_ACTIVE_UIDX,
} from '../../database/schema/imports';
import { withMerchant } from '../../database/with-merchant';
import { ImportRepository, type NewPostValues } from '../import.repository';

const post = (postId: string, overrides: Partial<NewPostValues> = {}): NewPostValues => ({
  postId,
  createdTime: null,
  caption: 'Jamdani saree',
  permalinkUrl: null,
  photoCount: 0,
  result: 'not_product',
  reason: null,
  matchedProductIds: [],
  suggestedCategory: null,
  productIds: [],
  extracted: null,
  ...overrides,
});

const range = { since: '2026-07-01', until: '2026-09-30', startedBy: null };

it('keeps the schema literals equal to the shared enums', () => {
  expect([...IMPORT_SOURCE_VALUES]).toEqual([...importSources]);
  expect([...IMPORT_STATUS_VALUES]).toEqual([...importRunStatuses]);
  expect([...IMPORT_POST_RESULT_VALUES]).toEqual([...importPostResults]);
});

describeDb('ImportRepository (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  const repo = new ImportRepository();
  const scopeA = () => ({ merchantId: t.merchantA });
  const scopeB = () => ({ merchantId: t.merchantB });

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  afterEach(async () => {
    await t.db.delete(schema.productImport).where(eq(schema.productImport.merchantId, t.merchantA));
    await t.db.delete(schema.productImport).where(eq(schema.productImport.merchantId, t.merchantB));
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  const startRun = (merchantId: string) =>
    withMerchant(runtime.db, merchantId, (tx) => repo.insertRun(tx, { merchantId }, range));

  it('allows one queued, running or stopping run per shop, even under a race', async () => {
    const results = await Promise.allSettled([startRun(t.merchantA), startRun(t.merchantA)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(await pgErrorOf(Promise.reject((refused as PromiseRejectedResult).reason))).toEqual({
      code: '23505',
      constraint: PRODUCT_IMPORT_ACTIVE_UIDX,
    });

    // Another shop is not held up, and a stopped run frees the slot.
    await expect(startRun(t.merchantB)).resolves.toMatchObject({ status: 'queued' });
    const [running] = await t.db
      .select()
      .from(schema.productImport)
      .where(eq(schema.productImport.merchantId, t.merchantA));
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.updateRun(tx, scopeA(), running!.id, { status: 'stopped' }),
    );
    await expect(startRun(t.merchantA)).resolves.toMatchObject({ status: 'queued' });
  });

  it('keeps one row per post in a run, and replaces it on a second write', async () => {
    const run = await startRun(t.merchantA);
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.upsertPost(tx, scopeA(), run.id, post('1_10', { result: 'failed' })),
    );
    const again = await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.upsertPost(tx, scopeA(), run.id, post('1_10', { result: 'not_product' })),
    );
    expect(again.result).toBe('not_product');
    const rows = await t.db
      .select()
      .from(schema.productImportPost)
      .where(eq(schema.productImportPost.importId, run.id));
    expect(rows).toHaveLength(1);

    await expect(
      pgErrorOf(
        t.db
          .insert(schema.productImportPost)
          .values({ merchantId: t.merchantA, importId: run.id, ...post('1_10') }),
      ),
    ).resolves.toEqual({
      code: '23505',
      constraint: 'product_import_post_merchant_import_post_uq',
    });
  });

  it('finds a post an earlier run handled, unless it failed there', async () => {
    const earlier = await startRun(t.merchantA);
    await withMerchant(runtime.db, t.merchantA, async (tx) => {
      await repo.upsertPost(tx, scopeA(), earlier.id, post('1_20', { result: 'in_catalog' }));
      await repo.upsertPost(tx, scopeA(), earlier.id, post('1_21', { result: 'failed' }));
      await repo.updateRun(tx, scopeA(), earlier.id, { status: 'finished' });
    });
    const run = await startRun(t.merchantA);
    const before = (graphId: string) =>
      withMerchant(runtime.db, t.merchantA, (tx) =>
        repo.importedBefore(tx, scopeA(), run.id, graphId, []),
      );
    expect(await before('1_20')).toBe(true);
    expect(await before('1_21')).toBe(false);
    expect(await before('1_22')).toBe(false);
  });

  it('counts a post linked to a product as imported, by its id or alias', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    await t.db.insert(schema.productPost).values({
      merchantId: t.merchantA,
      productId: product.id,
      postId: '555',
      aliasId: 'pfbid0abcdefghijk',
      status: 'suggested',
    });
    const run = await startRun(t.merchantA);
    const before = (keys: string[]) =>
      withMerchant(runtime.db, t.merchantA, (tx) =>
        repo.importedBefore(tx, scopeA(), run.id, '1_x', keys),
      );
    expect(await before(['555'])).toBe(true);
    expect(await before(['pfbid0abcdefghijk'])).toBe(true);
    expect(await before(['556'])).toBe(false);
  });

  it('lists the summary tabs by what the drafts still need', async () => {
    const run = await startRun(t.merchantA);
    const priced = await seedProduct(t.db, t.merchantA, { name: 'Priced', status: 'draft' });
    await seedVariant(t.db, t.merchantA, priced.id, { name: null, isDefault: true, stock: null });
    const unpriced = await seedProduct(t.db, t.merchantA, { name: 'Unpriced', status: 'draft' });
    await seedVariant(t.db, t.merchantA, unpriced.id, {
      name: null,
      isDefault: true,
      price: null,
      stock: null,
    });
    await withMerchant(runtime.db, t.merchantA, async (tx) => {
      await repo.upsertPost(
        tx,
        scopeA(),
        run.id,
        post('1_1', { result: 'draft', productIds: [priced.id] }),
      );
      await repo.upsertPost(
        tx,
        scopeA(),
        run.id,
        post('1_2', { result: 'draft', productIds: [unpriced.id] }),
      );
      await repo.upsertPost(tx, scopeA(), run.id, post('1_3', { result: 'in_catalog' }));
      await repo.upsertPost(tx, scopeA(), run.id, post('1_4', { result: 'already_imported' }));
    });
    const tab = (filter: 'needs_info' | 'ready' | 'skipped') =>
      withMerchant(runtime.db, t.merchantA, async (tx) =>
        (await repo.listPosts(tx, scopeA(), run.id, { filter, offset: 0, limit: 10 })).map(
          (row) => row.postId,
        ),
      );
    expect(await tab('ready')).toEqual(['1_1']);
    expect(await tab('needs_info')).toEqual(['1_2']);
    expect(await tab('skipped')).toEqual(['1_3']);
    const left = await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.leftToReview(tx, scopeA(), [run.id]),
    );
    expect(left.get(run.id)).toBe(2);
  });

  it("never lets one merchant see or write another's runs and posts", async () => {
    const runA = await startRun(t.merchantA);
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      repo.upsertPost(tx, scopeA(), runA.id, post('1_30')),
    );

    // B's context and scope see nothing of A's.
    await withMerchant(runtime.db, t.merchantB, async (tx) => {
      expect(await repo.findRun(tx, scopeB(), runA.id)).toBeUndefined();
      expect(await repo.listRuns(tx, scopeB(), { offset: 0, limit: 10 })).toEqual([]);
      expect(await repo.findPostInRun(tx, scopeB(), runA.id, '1_30')).toBeUndefined();
      expect(await repo.importedBefore(tx, scopeB(), runA.id, '1_30', [])).toBe(false);
      expect(await tx.select().from(schema.productImportPost)).toEqual([]);
    });
    // A's scope under B's context: the policy hides A's rows.
    await withMerchant(runtime.db, t.merchantB, async (tx) => {
      expect(await repo.findRun(tx, scopeA(), runA.id)).toBeUndefined();
    });

    // B's context, B's scope, A's run: no such (merchant, run) pair for the key.
    await expect(
      pgErrorOf(
        withMerchant(runtime.db, t.merchantB, (tx) =>
          repo.upsertPost(tx, scopeB(), runA.id, post('1_31')),
        ),
      ),
    ).resolves.toEqual({ code: '23503', constraint: 'product_import_post_import_fk' });

    // A scope that differs from the context is refused by the policy's WITH CHECK.
    await expect(
      withMerchant(runtime.db, t.merchantA, (tx) => repo.insertRun(tx, scopeB(), range)),
    ).rejects.toMatchObject({
      cause: { code: '42501', message: expect.stringMatching(/row-level security/) },
    });

    // Counting a run in B's context touches nothing of A's.
    await withMerchant(runtime.db, t.merchantB, (tx) =>
      repo.addCounts(tx, scopeB(), runA.id, { drafts: 5 }),
    );
    const [after] = await t.db
      .select()
      .from(schema.productImport)
      .where(eq(schema.productImport.id, runA.id));
    expect(after!.drafts).toBe(0);
  });
});
