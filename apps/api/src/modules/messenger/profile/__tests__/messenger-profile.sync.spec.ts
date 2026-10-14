import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
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
import { seedFacebookPage } from '../../../database/__tests__/conversation-seeds';
import { SYNC_PROFILE_JOB, type SyncProfileJob } from '../../../queue/queue.constants';
import { MerchantSettingsRepository } from '../../../settings/merchant-settings.repository';
import { FacebookPageRepository } from '../../page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../page/meta-graph.client';
import type { MessengerProfileBody } from '../messenger-profile';
import { MessengerProfileSync } from '../messenger-profile.sync';
import { defaultWelcome } from '../welcome-defaults';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

class FakeGraph {
  profiles: MessengerProfileBody[] = [];
  tokens: string[] = [];
  subscribed: string[] = [];
  cleared: string[] = [];
  failWith: Error | null = null;
  async setMessengerProfile(token: string, body: MessengerProfileBody) {
    if (this.failWith) throw this.failWith;
    this.tokens.push(token);
    this.profiles.push(body);
  }
  async subscribeApp(pageId: string) {
    if (this.failWith) throw this.failWith;
    this.subscribed.push(pageId);
  }
  async clearMessengerProfile(token: string) {
    if (this.failWith) throw this.failWith;
    this.cleared.push(token);
  }
}

class FakeQueue {
  added: { name: string; data: unknown; opts: unknown }[] = [];
  async add(name: string, data: unknown, opts: unknown) {
    this.added.push({ name, data, opts });
  }
}

// As app_runtime: the reads and the writes run under the same row-level
// security as production.
describeDb('MessengerProfileSync (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let graph: FakeGraph;
  let queue: FakeQueue;
  let sync: MessengerProfileSync;

  const makeSync = (client: MetaGraphClient | null) =>
    new MessengerProfileSync(
      runtime.db,
      new FacebookPageRepository(),
      new MerchantSettingsRepository(),
      crypto,
      client,
      queue as unknown as Queue,
    );

  const saveWelcome = async (
    merchantId: string,
    welcome: { greeting: string | null; iceBreakers: unknown },
    country = 'US',
  ) => {
    const values = {
      messengerGreeting: welcome.greeting,
      iceBreakers: welcome.iceBreakers,
    };
    await t.db
      .insert(schema.merchantSettings)
      .values({
        merchantId,
        country,
        currency: 'USD',
        timeZone: 'UTC',
        dateFormat: 'yyyy-MM-dd',
        ...values,
      })
      .onConflictDoUpdate({
        target: schema.merchantSettings.merchantId,
        set: { country, ...values },
      });
  };
  const pageOf = async (merchantId: string) => {
    const [row] = await t.db
      .select()
      .from(schema.facebookPage)
      .where(eq(schema.facebookPage.merchantId, merchantId));
    return row;
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    pageA = (await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') }))
      .pageId;
  });

  beforeEach(async () => {
    graph = new FakeGraph();
    queue = new FakeQueue();
    sync = makeSync(graph as unknown as MetaGraphClient);
    await t.db
      .delete(schema.merchantSettings)
      .where(eq(schema.merchantSettings.merchantId, t.merchantA));
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('stamps the request and queues a job that carries only the shop', async () => {
    await sync.request(t.merchantA, { resubscribe: true });

    expect(queue.added).toEqual([
      {
        name: SYNC_PROFILE_JOB,
        data: { merchantId: t.merchantA, resubscribe: true },
        opts: expect.objectContaining({
          jobId: expect.stringMatching(/^profile-/),
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        }),
      },
    ]);
    expect(await pageOf(t.merchantA)).toMatchObject({
      profileSyncRequestedAt: expect.any(Date),
      profileSyncError: null,
    });
  });

  it('syncs the settings read at run time, not at enqueue', async () => {
    await saveWelcome(t.merchantA, { greeting: 'First', iceBreakers: [] });
    await sync.request(t.merchantA);
    await saveWelcome(t.merchantA, { greeting: 'Second', iceBreakers: [] });
    await sync.request(t.merchantA);

    for (const job of queue.added) await sync.run(job.data as SyncProfileJob);

    expect(graph.profiles.map((body) => body.greeting[0]?.text)).toEqual(['Second', 'Second']);
    expect(graph.tokens).toEqual(['token-A', 'token-A']);
    expect(await pageOf(t.merchantA)).toMatchObject({
      profileSyncError: null,
      profileSyncedAt: expect.any(Date),
    });
  });

  it('sends the defaults for the shop’s language until the seller saves', async () => {
    await saveWelcome(t.merchantA, { greeting: null, iceBreakers: null }, 'BD');

    await expect(sync.run({ merchantId: t.merchantA })).resolves.toBe('synced');

    const bn = defaultWelcome('bn');
    expect(graph.profiles[0]?.ice_breakers[0]?.call_to_actions).toHaveLength(bn.iceBreakers.length);
    expect(graph.profiles[0]?.persistent_menu[0]?.call_to_actions[0]?.title).toBe('পণ্য দেখুন');
  });

  it('sends the same body twice in a row (idempotent re-apply)', async () => {
    await sync.run({ merchantId: t.merchantA });
    await sync.run({ merchantId: t.merchantA });
    expect(graph.profiles[0]).toEqual(graph.profiles[1]);
  });

  it('records token_invalid and does not retry on an expired token', async () => {
    graph.failWith = new GraphError(400, 190, 'expired');
    await expect(sync.run({ merchantId: t.merchantA })).resolves.toBe('failed');
    expect(await pageOf(t.merchantA)).toMatchObject({ profileSyncError: 'token_invalid' });
  });

  it('throws on another Graph error so BullMQ retries, after recording graph_error', async () => {
    graph.failWith = new GraphError(500, 2, 'down');
    await expect(sync.run({ merchantId: t.merchantA })).rejects.toThrow();
    expect(await pageOf(t.merchantA)).toMatchObject({ profileSyncError: 'graph_error' });
  });

  it('records graph_error and retries when the token cannot be decrypted', async () => {
    const good = (await pageOf(t.merchantA))?.accessToken ?? '';
    const setToken = (accessToken: string) =>
      t.db
        .update(schema.facebookPage)
        .set({ accessToken, profileSyncError: null })
        .where(eq(schema.facebookPage.merchantId, t.merchantA));
    await setToken('not-a-ciphertext');
    try {
      await expect(sync.run({ merchantId: t.merchantA })).rejects.toThrow();
      expect(await pageOf(t.merchantA)).toMatchObject({ profileSyncError: 'graph_error' });
      expect(graph.profiles).toEqual([]);
    } finally {
      await setToken(good);
    }
  });

  it('re-subscribes the Page’s webhooks when asked', async () => {
    await sync.run({ merchantId: t.merchantA, resubscribe: true });
    expect(graph.subscribed).toEqual([pageA]);
  });

  it('does nothing for a shop without a Page, or without Meta configured', async () => {
    await expect(sync.run({ merchantId: t.merchantB })).resolves.toBe('no_page');
    await expect(makeSync(null).run({ merchantId: t.merchantA })).resolves.toBe('no_page');
    expect(graph.profiles).toEqual([]);
  });

  it('clears the profile with the decrypted token, and swallows a failure', async () => {
    const scope = { merchantId: t.merchantA };
    await sync.clear(scope, crypto.encrypt('token-A'));
    expect(graph.cleared).toEqual(['token-A']);

    graph.failWith = new GraphError(500, 2, 'down');
    await expect(sync.clear(scope, crypto.encrypt('token-A'))).resolves.toBeUndefined();
  });
});
