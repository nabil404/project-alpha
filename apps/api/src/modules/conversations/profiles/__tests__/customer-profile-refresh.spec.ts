import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedFacebookPage,
} from '../../../database/__tests__/conversation-seeds';
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../../messenger/page/meta-graph.client';
import { CustomerRepository } from '../../customer.repository';
import {
  CustomerProfileRefresh,
  PROFILE_ACTIVE_WINDOW_MS,
  PROFILE_REFRESH_MAX_FAILURES,
} from '../customer-profile-refresh';
import { CustomerProfileReader } from '../customer-profile.reader';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

const pictureOf = (psid: string) => `https://platform-lookaside.fbsbx.com/pic?psid=${psid}`;

class FakeGraph {
  calls: { token: string; psid: string }[] = [];
  fail = false;
  async getUserProfile(token: string, psid: string) {
    this.calls.push({ token, psid });
    if (this.fail) throw new GraphError(400, 100, 'no profile');
    return { name: `Customer ${psid}`, pictureUrl: pictureOf(psid) };
  }
}

// As app_runtime: had any read run without merchant context, row-level
// security would show no Page and no customers, and nothing would refresh.
describeDb('CustomerProfileRefresh (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let graph: FakeGraph;
  let refresh: CustomerProfileRefresh;

  const build = (client: MetaGraphClient | null) =>
    new CustomerProfileRefresh(
      runtime.db,
      new CustomerProfileReader(crypto, client),
      new FacebookPageRepository(),
      new CustomerRepository(),
    );
  /** A customer who wrote an hour ago, never profiled unless `profile` says otherwise. */
  const activeCustomer = async (
    merchantId: string,
    profile: Partial<typeof schema.customer.$inferInsert> = {},
    lastMessageAt = new Date(Date.now() - 3_600_000),
  ) => {
    const row = await seedCustomer(t.db, merchantId, {
      psid: `psid-${randomUUID()}`,
      name: null,
      pictureUrl: null,
      profileFetchedAt: null,
      ...profile,
    });
    await seedConversation(t.db, merchantId, { customerId: row.id, lastMessageAt });
    return row;
  };
  const customerRow = async (id: string) =>
    (await t.db.select().from(schema.customer).where(eq(schema.customer.id, id)))[0];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') });
  });

  beforeEach(() => {
    graph = new FakeGraph();
    refresh = build(graph as unknown as MetaGraphClient);
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('reads the profile of each due customer with the Page token and stores it', async () => {
    const due = await activeCustomer(t.merchantA);
    const fresh = await activeCustomer(t.merchantA, {
      name: 'Fresh',
      profileFetchedAt: new Date(),
    });

    const report = await refresh.refreshMerchant(t.merchantA);

    expect(report).toMatchObject({ failed: 0, aborted: false });
    expect(graph.calls).toContainEqual({ token: 'token-A', psid: due.psid });
    expect(graph.calls.map((call) => call.psid)).not.toContain(fresh.psid);
    expect(await customerRow(due.id)).toMatchObject({
      name: `Customer ${due.psid}`,
      pictureUrl: pictureOf(due.psid),
    });
    expect((await customerRow(due.id))?.profileFetchedAt).toBeInstanceOf(Date);
  });

  it('skips customers with no recent conversation', async () => {
    const quiet = await activeCustomer(
      t.merchantA,
      {},
      new Date(Date.now() - PROFILE_ACTIVE_WINDOW_MS - 3_600_000),
    );
    await refresh.refreshMerchant(t.merchantA);
    expect(graph.calls.map((call) => call.psid)).not.toContain(quiet.psid);
  });

  it('keeps the known name and picture when a read fails, and records the attempt', async () => {
    const known = await activeCustomer(t.merchantA, {
      name: 'Nusrat Jahan',
      pictureUrl: 'https://platform-lookaside.fbsbx.com/pic?old',
      profileFetchedAt: new Date(Date.now() - 4 * 24 * 3_600_000),
    });
    graph.fail = true;

    await refresh.refreshMerchant(t.merchantA);

    const row = await customerRow(known.id);
    expect(row).toMatchObject({
      name: 'Nusrat Jahan',
      pictureUrl: 'https://platform-lookaside.fbsbx.com/pic?old',
    });
    expect(row!.profileFetchedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it(`stops a shop's run after ${PROFILE_REFRESH_MAX_FAILURES} failed reads in a row`, async () => {
    for (let i = 0; i < PROFILE_REFRESH_MAX_FAILURES + 2; i += 1) await activeCustomer(t.merchantA);
    graph.fail = true;

    const report = await refresh.refreshMerchant(t.merchantA);

    expect(report).toEqual({ read: 0, failed: PROFILE_REFRESH_MAX_FAILURES, aborted: true });
    expect(graph.calls).toHaveLength(PROFILE_REFRESH_MAX_FAILURES);
  });

  it("does nothing for a shop without a Page, and never reads another shop's customers", async () => {
    const inB = await activeCustomer(t.merchantB);

    await expect(refresh.refreshMerchant(t.merchantB)).resolves.toEqual({
      read: 0,
      failed: 0,
      aborted: false,
    });
    await refresh.refreshMerchant(t.merchantA);

    expect(graph.calls.map((call) => call.psid)).not.toContain(inB.psid);
    expect((await customerRow(inB.id))?.profileFetchedAt).toBeNull();
  });

  it('does nothing when the Messenger app is not configured', async () => {
    await activeCustomer(t.merchantA);
    await expect(build(null).refreshAll()).resolves.toMatchObject({ merchants: 0, read: 0 });
  });
});
