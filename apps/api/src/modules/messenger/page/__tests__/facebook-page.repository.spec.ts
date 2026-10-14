import { eq, sql } from 'drizzle-orm';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { seedFacebookPage } from '../../../database/__tests__/conversation-seeds';
import { withMerchant } from '../../../database/with-merchant';
import { FacebookPageRepository } from '../facebook-page.repository';

// As app_runtime, so the writes and the cross-shop listing run under RLS.
describeDb('FacebookPageRepository (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  const pages = new FacebookPageRepository();

  const pageOf = async (merchantId: string) => {
    const [row] = await t.db
      .select()
      .from(schema.facebookPage)
      .where(eq(schema.facebookPage.merchantId, merchantId));
    return row;
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    await seedFacebookPage(t.db, t.merchantA);
    await seedFacebookPage(t.db, t.merchantB);
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('records a request, and a fresh request never reads as failed', async () => {
    const scope = { merchantId: t.merchantA };
    const failedAt = new Date('2026-10-14T09:00:00Z');
    const requestedAt = new Date('2026-10-14T10:00:00Z');
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileFailed(tx, scope, 'graph_error', failedAt),
    );

    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileRequested(tx, scope, requestedAt),
    );

    expect(await pageOf(t.merchantA)).toMatchObject({
      profileSyncRequestedAt: requestedAt,
      profileSyncError: null,
    });
  });

  it('records a sync, clearing an earlier error', async () => {
    const scope = { merchantId: t.merchantA };
    const syncedAt = new Date('2026-10-14T11:00:00Z');
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileFailed(tx, scope, 'token_invalid', new Date()),
    );

    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileSynced(tx, scope, syncedAt),
    );

    expect(await pageOf(t.merchantA)).toMatchObject({
      profileSyncedAt: syncedAt,
      profileSyncError: null,
    });
  });

  it('records a failure without touching the last sync, and only for its own shop', async () => {
    const syncedAt = new Date('2026-10-14T12:00:00Z');
    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileSynced(tx, { merchantId: t.merchantA }, syncedAt),
    );

    await withMerchant(runtime.db, t.merchantA, (tx) =>
      pages.markProfileFailed(tx, { merchantId: t.merchantA }, 'token_invalid', new Date()),
    );

    expect(await pageOf(t.merchantA)).toMatchObject({
      profileSyncedAt: syncedAt,
      profileSyncError: 'token_invalid',
    });
    expect(await pageOf(t.merchantB)).toMatchObject({ profileSyncError: null });
  });

  it('lists every connected shop without a merchant context, through the function only', async () => {
    const ids = await pages.listConnectedMerchantIds(runtime.db);

    expect(ids).toEqual(expect.arrayContaining([t.merchantA, t.merchantB]));
    // The table itself still shows nothing without context.
    await expect(runtime.db.select().from(schema.facebookPage)).resolves.toEqual([]);
  });

  it('lets only app_runtime call the listing, which app_page_resolver owns', async () => {
    const privileges = await t.db.execute<{ public: boolean; runtime: boolean; owner: string }>(
      sql`select
            has_function_privilege('public', 'app_connected_merchants()', 'EXECUTE') as public,
            has_function_privilege('app_runtime', 'app_connected_merchants()', 'EXECUTE') as runtime,
            (select proowner::regrole::text from pg_proc
              where oid = 'app_connected_merchants()'::regprocedure) as owner`,
    );
    expect(privileges.rows).toEqual([{ public: false, runtime: true, owner: 'app_page_resolver' }]);
  });
});
