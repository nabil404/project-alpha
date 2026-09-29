import { sql } from 'drizzle-orm';
import type { Transaction } from '../../../database/base.repository';
import { withMerchant } from '../../../database/with-merchant';
import {
  describeDb,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedMessage,
} from '../../../database/__tests__/conversation-seeds';
import { ConversationRepository } from '../conversation.repository';
import { MessageRepository } from '../message.repository';

describeDb('read repositories (app_runtime, two merchants)', () => {
  const conversations = new ConversationRepository();
  const messages = new MessageRepository();
  let t: CatalogTestDb;

  const as = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });
  const minute = (n: number) => new Date(Date.UTC(2026, 8, 29, 10, n));

  // Merchant A: five conversations, one per minute, newest = e.
  let ids: Record<'a' | 'b' | 'c' | 'd' | 'e', string>;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    const nusrat = await seedCustomer(t.db, t.merchantA, { name: 'Nusrat Jahan' });
    const tanvir = await seedCustomer(t.db, t.merchantA, { name: 'Tanvir Ahmed' });
    const a = await seedConversation(t.db, t.merchantA, {
      customerId: nusrat.id,
      lastMessageAt: minute(1),
    });
    const b = await seedConversation(t.db, t.merchantA, {
      customerId: tanvir.id,
      lastMessageAt: minute(2),
      state: 'handed_off',
    });
    const c = await seedConversation(t.db, t.merchantA, {
      lastMessageAt: minute(3),
      state: 'awaiting_confirmation',
      sellerLastReadAt: minute(4),
    });
    const d = await seedConversation(t.db, t.merchantA, {
      lastMessageAt: minute(4),
      sellerLastReadAt: minute(5),
    });
    const e = await seedConversation(t.db, t.merchantA, { lastMessageAt: minute(5) });
    ids = { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id };
    await seedMessage(t.db, t.merchantA, c.id, { text: 'Is the black one back in stock?' });
    await seedMessage(t.db, t.merchantA, d.id, { text: 'Is there 50% off_today?' });
    await seedMessage(t.db, t.merchantA, e.id, { text: 'পাঞ্জাবির সাইজ কী কী আছে?' });
    await seedConversation(t.db, t.merchantB, { lastMessageAt: minute(6) });
  });

  afterAll(async () => {
    await t.close();
  });

  const listA = (query: Partial<Parameters<ConversationRepository['list']>[2]> = {}) =>
    as(t.merchantA, (tx) =>
      conversations.list(tx, { merchantId: t.merchantA }, { filter: 'all', limit: 25, ...query }),
    ).then((rows) => rows.map((row) => row.conversation.id));

  it('lists newest activity first, with the customer name, for this merchant only', async () => {
    expect(await listA()).toEqual([ids.e, ids.d, ids.c, ids.b, ids.a]);
    const [first] = await as(t.merchantA, (tx) =>
      conversations.list(tx, { merchantId: t.merchantA }, { filter: 'all', limit: 25 }),
    );
    expect(first?.customerName).toBe('Nusrat Jahan');
  });

  it('pages by cursor without gaps or repeats, even when a row moves to the top', async () => {
    const page1 = await as(t.merchantA, (tx) =>
      conversations.list(tx, { merchantId: t.merchantA }, { filter: 'all', limit: 2 }),
    );
    const last = page1.at(-1)!.conversation;
    // c gets a new message between the two requests and jumps to the top.
    await t.db.execute(
      sql`update conversation set last_message_at = ${minute(9).toISOString()}::timestamptz where id = ${ids.c}`,
    );
    const page2 = await listA({ after: { at: last.lastMessageAt, id: last.id }, limit: 10 });

    expect(page1.map((row) => row.conversation.id)).toEqual([ids.e, ids.d]);
    expect(page2).toEqual([ids.b, ids.a]);
    await t.db.execute(
      sql`update conversation set last_message_at = ${minute(3).toISOString()}::timestamptz where id = ${ids.c}`,
    );
  });

  it('filters by the page’s chips', async () => {
    expect(await listA({ filter: 'needs_you' })).toEqual([ids.b]);
    expect(await listA({ filter: 'drafted' })).toEqual([ids.c]);
    // Unread: the customer wrote after the seller last read (c and d were read after).
    expect(await listA({ filter: 'unread' })).toEqual([ids.e, ids.b, ids.a]);
  });

  it('searches names and message text literally, including Bangla', async () => {
    expect(await listA({ q: 'tanvir' })).toEqual([ids.b]);
    expect(await listA({ q: 'black one' })).toEqual([ids.c]);
    expect(await listA({ q: '50% off_' })).toEqual([ids.d]);
    expect(await listA({ q: '%' })).toEqual([ids.d]);
    expect(await listA({ q: 'সাইজ' })).toEqual([ids.e]);
  });

  it('counts each chip, as integers, for this merchant only', async () => {
    await expect(
      as(t.merchantA, (tx) => conversations.counts(tx, { merchantId: t.merchantA })),
    ).resolves.toEqual({ all: 5, needsYou: 1, drafted: 1, unread: 3 });
    await expect(
      as(t.merchantB, (tx) => conversations.counts(tx, { merchantId: t.merchantB })),
    ).resolves.toEqual({ all: 1, needsYou: 0, drafted: 0, unread: 1 });
  });

  it("never finds, lists or updates another merchant's conversation", async () => {
    const scopeB = { merchantId: t.merchantB };
    await expect(
      as(t.merchantB, (tx) => conversations.findById(tx, scopeB, ids.a)),
    ).resolves.toBeNull();
    await expect(
      as(t.merchantB, (tx) => conversations.update(tx, scopeB, ids.a, { botPaused: true })),
    ).resolves.toBeNull();
    // Only merchant A has a customer named Tanvir.
    const listedByB = await as(t.merchantB, (tx) =>
      conversations.list(tx, scopeB, { filter: 'all', q: 'Tanvir', limit: 25 }),
    );
    expect(listedByB).toEqual([]);
    await expect(
      as(t.merchantB, (tx) => messages.listPage(tx, scopeB, ids.c, { limit: 10 })),
    ).resolves.toEqual([]);
  });

  // The cases above run as merchant B, so RLS alone would hide merchant A's rows. These run
  // in A's context, where RLS shows A's rows, and pass B's scope: only the repositories'
  // own merchantId filter can hide them.
  describe('filter, not policy', () => {
    const other = () => ({ merchantId: t.merchantB });

    it('list returns nothing under another merchant scope', async () => {
      await expect(
        as(t.merchantA, (tx) => conversations.list(tx, other(), { filter: 'all', limit: 25 })),
      ).resolves.toEqual([]);
      await expect(
        as(t.merchantA, (tx) =>
          conversations.list(tx, other(), { filter: 'all', q: 'Tanvir', limit: 25 }),
        ),
      ).resolves.toEqual([]);
    });

    it('counts are all zero: A’s rows hidden by the filter, B’s own hidden by RLS', async () => {
      await expect(as(t.merchantA, (tx) => conversations.counts(tx, other()))).resolves.toEqual({
        all: 0,
        needsYou: 0,
        drafted: 0,
        unread: 0,
      });
    });

    it('findById does not find the conversation, locked or not', async () => {
      await expect(
        as(t.merchantA, (tx) => conversations.findById(tx, other(), ids.a)),
      ).resolves.toBeNull();
      await expect(
        as(t.merchantA, (tx) => conversations.findById(tx, other(), ids.a, { lock: true })),
      ).resolves.toBeNull();
    });

    it('update changes nothing', async () => {
      await expect(
        as(t.merchantA, (tx) => conversations.update(tx, other(), ids.a, { botPaused: true })),
      ).resolves.toBeNull();
      const [row] = (
        await t.db.execute(sql`select bot_paused from conversation where id = ${ids.a}`)
      ).rows;
      expect(row?.bot_paused).toBe(false);
    });

    it('listPage returns no messages', async () => {
      await expect(
        as(t.merchantA, (tx) => messages.listPage(tx, other(), ids.c, { limit: 10 })),
      ).resolves.toEqual([]);
    });
  });

  it('finds a conversation with its customer, and updates it', async () => {
    const found = await as(t.merchantA, (tx) =>
      conversations.findById(tx, { merchantId: t.merchantA }, ids.a, { lock: true }),
    );
    expect(found?.customer.name).toBe('Nusrat Jahan');

    const readAt = minute(30);
    const updated = await as(t.merchantA, (tx) =>
      conversations.update(tx, { merchantId: t.merchantA }, ids.a, { sellerLastReadAt: readAt }),
    );
    expect(updated?.sellerLastReadAt).toEqual(readAt);
  });

  it('pages a thread newest first, by cursor', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    const sent = [];
    for (let n = 0; n < 5; n++) {
      sent.push(
        await seedMessage(t.db, t.merchantA, convo.id, { text: `m${n}`, sentAt: minute(10 + n) }),
      );
    }
    const scopeA = { merchantId: t.merchantA };

    const newest = await as(t.merchantA, (tx) =>
      messages.listPage(tx, scopeA, convo.id, { limit: 2 }),
    );
    expect(newest.map((row) => row.text)).toEqual(['m4', 'm3']);

    const oldest = newest.at(-1)!;
    const older = await as(t.merchantA, (tx) =>
      messages.listPage(tx, scopeA, convo.id, {
        before: { at: oldest.sentAt, id: oldest.id },
        limit: 10,
      }),
    );
    expect(older.map((row) => row.text)).toEqual(['m2', 'm1', 'm0']);
  });
});
