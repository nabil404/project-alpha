import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Transaction } from '../../../database/base.repository';
import * as schema from '../../../database/schema/index';
import { withMerchant } from '../../../database/with-merchant';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedMessage,
} from '../../../database/__tests__/conversation-seeds';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import { MessageRepository } from '../../message.repository';
import { CustomerPhotoStore, type PhotoDownloader } from '../customer-photo.store';

// As app_runtime: the store reads and writes under the same row-level security
// as production. The "filter, not policy" cases run in merchant A's context
// with merchant B's scope, so only the repository's own filter can hide A's rows.
describeDb('CustomerPhotoStore (app_runtime, two merchants)', () => {
  const messages = new MessageRepository();
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let storage: InMemoryObjectStorage;
  let downloads: string[];
  let jpeg: Buffer;

  const as = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });
  const store = (download?: PhotoDownloader) =>
    new CustomerPhotoStore(
      runtime.db,
      messages,
      storage,
      download ??
        (async (url) => {
          downloads.push(String(url));
          return { ok: true, body: jpeg };
        }),
    );
  const photoMessage = async (
    merchantId: string,
    urls: (string | null)[] = ['https://scontent.xx.fbcdn.net/a.jpg'],
    overrides: Partial<typeof schema.message.$inferInsert> = {},
  ) => {
    const customer = await seedCustomer(t.db, merchantId);
    const convo = await seedConversation(t.db, merchantId, { customerId: customer.id });
    return seedMessage(t.db, merchantId, convo.id, {
      kind: 'image',
      text: '',
      details: { attachments: urls.map((url) => ({ url })) },
      ...overrides,
    });
  };
  const detailsOf = async (id: string) =>
    (await t.db.select().from(schema.message).where(eq(schema.message.id, id)))[0]?.details;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00c' } })
      .jpeg()
      .toBuffer();
  });
  beforeEach(() => {
    storage = new InMemoryObjectStorage();
    downloads = [];
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('copies each photo once to a fixed key and records it on the message', async () => {
    const row = await photoMessage(t.merchantA, [
      'https://scontent.xx.fbcdn.net/a.jpg',
      'https://scontent.xx.fbcdn.net/b.jpg',
    ]);
    const keys = [0, 1].map((index) => `c/${t.merchantA}/${row.id}-${index}.jpg`);

    const first = await store().ensureStored({ merchantId: t.merchantA }, row.id);
    const again = await store().ensureStored({ merchantId: t.merchantA }, row.id);

    expect(first).toEqual({
      transient: false,
      photos: keys.map((key) => ({ ok: true, key, url: storage.publicUrl(key) })),
    });
    expect(again).toEqual(first);
    expect(downloads).toHaveLength(2);
    expect([...storage.objects.keys()].sort()).toEqual(keys);
    expect(storage.objects.get(keys[0]!)?.options.contentType).toBe('image/jpeg');
    expect(await detailsOf(row.id)).toEqual({
      attachments: [
        { url: 'https://scontent.xx.fbcdn.net/a.jpg', key: keys[0] },
        { url: 'https://scontent.xx.fbcdn.net/b.jpg', key: keys[1] },
      ],
    });
  });

  it('records a refused download and never tries it again', async () => {
    const row = await photoMessage(t.merchantA);
    let tries = 0;
    const tooBig: PhotoDownloader = async () => {
      tries += 1;
      return { ok: false, reason: 'too_large' };
    };

    await store(tooBig).ensureStored({ merchantId: t.merchantA }, row.id);
    const again = await store(tooBig).ensureStored({ merchantId: t.merchantA }, row.id);

    expect(again?.photos).toEqual([{ ok: false, reason: 'too_large' }]);
    expect(tries).toBe(1);
  });

  it('records bytes that are not an image as unreadable', async () => {
    const row = await photoMessage(t.merchantA);
    const copies = await store(async () => ({
      ok: true,
      body: Buffer.from('not an image'),
    })).ensureStored({ merchantId: t.merchantA }, row.id);
    expect(copies?.photos).toEqual([{ ok: false, reason: 'unreadable' }]);
  });

  it('records nothing while storage is down, so the copy job tries again', async () => {
    const row = await photoMessage(t.merchantA);
    storage.failPut = () => true;

    const down = await store().ensureStored({ merchantId: t.merchantA }, row.id);
    expect(down).toEqual({ transient: true, photos: [{ ok: false, reason: 'failed' }] });
    expect(await detailsOf(row.id)).toEqual({
      attachments: [{ url: 'https://scontent.xx.fbcdn.net/a.jpg' }],
    });

    storage.failPut = () => false;
    const up = await store().ensureStored({ merchantId: t.merchantA }, row.id);
    expect(up?.photos[0]).toMatchObject({ ok: true });
  });

  it('is null for anything but a customer photo', async () => {
    const sticker = await photoMessage(t.merchantA, [null], { kind: 'sticker' });
    const ours = await photoMessage(t.merchantA, ['https://scontent.xx.fbcdn.net/a.jpg'], {
      sender: 'seller',
    });
    await expect(store().ensureStored({ merchantId: t.merchantA }, sticker.id)).resolves.toBeNull();
    await expect(store().ensureStored({ merchantId: t.merchantA }, ours.id)).resolves.toBeNull();
    expect(downloads).toEqual([]);
  });

  it("never copies or writes another merchant's message", async () => {
    const row = await photoMessage(t.merchantA);

    await expect(store().ensureStored({ merchantId: t.merchantB }, row.id)).resolves.toBeNull();
    expect(downloads).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });

  describe('MessageRepository photo methods (filter, not policy)', () => {
    it("finds and writes only the scope's own message", async () => {
      const row = await photoMessage(t.merchantA);

      await expect(
        as(t.merchantA, (tx) => messages.findById(tx, { merchantId: t.merchantB }, row.id)),
      ).resolves.toBeNull();
      await as(t.merchantA, (tx) =>
        messages.setDetails(tx, { merchantId: t.merchantB }, row.id, { attachments: [] }),
      );
      expect(await detailsOf(row.id)).toEqual({
        attachments: [{ url: 'https://scontent.xx.fbcdn.net/a.jpg' }],
      });

      await expect(
        as(t.merchantA, (tx) =>
          messages.findById(tx, { merchantId: t.merchantA }, row.id, { lock: true }),
        ),
      ).resolves.toMatchObject({ id: row.id });
    });
  });
});
