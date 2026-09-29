import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/base.repository';
import * as schema from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import {
  describeDb,
  openCatalogTestDb,
  pgErrorOf,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedCustomer } from '../../database/__tests__/conversation-seeds';
import { ConversationRepository } from '../conversation.repository';
import { CustomerRepository } from '../customer.repository';
import { MessageRepository } from '../message.repository';

// Runs as app_runtime so row-level security applies exactly as in production.
// Most cases run in the merchant's own context with its own scope, which proves
// behavior and isolation of the data as a whole. The "filter, not policy" cases
// run in merchant A's context but pass merchant B's scope against A's rows: row
// visibility is then A's, so only the repository's own merchantId filter can
// hide them. The mismatched-write cases show RLS and composite keys stop a
// cross-merchant write.
describeDb('ingest repositories (app_runtime, two merchants)', () => {
  const customers = new CustomerRepository();
  const conversations = new ConversationRepository();
  const messages = new MessageRepository();
  let t: CatalogTestDb;

  const as = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });
  const scope = (merchantId: string) => ({ merchantId });
  const at = (iso: string) => new Date(iso);

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('CustomerRepository', () => {
    it('creates a customer once and returns the same row after', async () => {
      const first = await as(t.merchantA, (tx) =>
        customers.upsert(tx, scope(t.merchantA), { psid: 'psid-once' }),
      );
      const again = await as(t.merchantA, (tx) =>
        customers.upsert(tx, scope(t.merchantA), { psid: 'psid-once' }),
      );
      expect(again.id).toBe(first.id);
      expect(first).toMatchObject({ name: null, pictureUrl: null, profileFetchedAt: null });
    });

    it('records a profile read, and keeps a known name and picture when a later read finds none', async () => {
      const fetchedAt = at('2026-09-29T10:00:00Z');
      const pictureUrl = 'https://platform-lookaside.fbsbx.com/pic?oe=1';
      await as(t.merchantA, (tx) =>
        customers.upsert(tx, scope(t.merchantA), {
          psid: 'psid-named',
          profile: { name: 'Nusrat Jahan', pictureUrl, fetchedAt },
        }),
      );
      const later = at('2026-09-30T10:00:00Z');
      const row = await as(t.merchantA, (tx) =>
        customers.upsert(tx, scope(t.merchantA), {
          psid: 'psid-named',
          profile: { name: null, pictureUrl: null, fetchedAt: later },
        }),
      );
      expect(row).toMatchObject({ name: 'Nusrat Jahan', pictureUrl, profileFetchedAt: later });
    });

    it('replaces the picture link with the one a later read returns', async () => {
      const read = (pictureUrl: string, fetchedAt: Date) =>
        as(t.merchantA, (tx) =>
          customers.upsert(tx, scope(t.merchantA), {
            psid: 'psid-renewed',
            profile: { name: 'Nusrat Jahan', pictureUrl, fetchedAt },
          }),
        );
      await read('https://platform-lookaside.fbsbx.com/pic?oe=1', at('2026-09-29T10:00:00Z'));
      const row = await read(
        'https://platform-lookaside.fbsbx.com/pic?oe=2',
        at('2026-10-02T10:00:00Z'),
      );
      expect(row.pictureUrl).toBe('https://platform-lookaside.fbsbx.com/pic?oe=2');
    });

    it('keeps the same person messaging two shops as two customers', async () => {
      const inA = await as(t.merchantA, (tx) =>
        customers.upsert(tx, scope(t.merchantA), { psid: 'psid-two-shops' }),
      );
      const inB = await as(t.merchantB, (tx) =>
        customers.upsert(tx, scope(t.merchantB), { psid: 'psid-two-shops' }),
      );
      expect(inB.id).not.toBe(inA.id);
    });

    it("never finds another merchant's customer", async () => {
      await seedCustomer(t.db, t.merchantA, { psid: 'psid-private' });
      await expect(
        as(t.merchantB, (tx) => customers.findByPsid(tx, scope(t.merchantB), 'psid-private')),
      ).resolves.toBeNull();
      await expect(
        as(t.merchantA, (tx) => customers.findByPsid(tx, scope(t.merchantA), 'psid-private')),
      ).resolves.toMatchObject({ psid: 'psid-private' });
    });

    it('filter, not policy: findByPsid hides a row RLS would show when the scope is another merchant', async () => {
      await seedCustomer(t.db, t.merchantA, { psid: 'psid-filter' });
      await expect(
        as(t.merchantA, (tx) => customers.findByPsid(tx, scope(t.merchantB), 'psid-filter')),
      ).resolves.toBeNull();
    });

    it('is stopped by row-level security when the scope and the context disagree', async () => {
      await expect(
        pgErrorOf(
          as(t.merchantB, (tx) => customers.upsert(tx, scope(t.merchantA), { psid: 'psid-rls' })),
        ),
      ).resolves.toMatchObject({ code: '42501' });
    });
  });

  describe('CustomerRepository profile refresh', () => {
    const now = at('2026-09-30T04:00:00Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3_600_000);
    const stale = (merchantId: string, limit = 200) =>
      as(merchantId, (tx) =>
        customers.listStaleProfiles(tx, scope(merchantId), {
          now,
          activeSince: daysAgo(30),
          limit,
        }),
      );
    /** A customer with one conversation whose last message was `activeDaysAgo` ago. */
    const customerWith = async (
      merchantId: string,
      profile: { name?: string | null; pictureUrl?: string | null; profileFetchedAt?: Date | null },
      activeDaysAgo = 1,
    ) => {
      const row = await seedCustomer(t.db, merchantId, { name: null, ...profile });
      await seedConversation(t.db, merchantId, {
        customerId: row.id,
        lastMessageAt: daysAgo(activeDaysAgo),
      });
      return row.id;
    };

    it('lists recently active customers whose profile is due, never-read first', async () => {
      const namedFresh = await customerWith(t.merchantA, {
        name: 'Fresh',
        profileFetchedAt: daysAgo(1),
      });
      const namedStale = await customerWith(t.merchantA, {
        name: 'Stale',
        profileFetchedAt: daysAgo(4),
      });
      const namelessRetry = await customerWith(t.merchantA, { profileFetchedAt: daysAgo(2) });
      const picturelessRetry = await customerWith(t.merchantA, {
        name: 'No picture',
        pictureUrl: null,
        profileFetchedAt: daysAgo(2),
      });
      const neverRead = await customerWith(t.merchantA, { profileFetchedAt: null });
      const inactive = await customerWith(t.merchantA, { profileFetchedAt: null }, 40);
      const noConversation = (await seedCustomer(t.db, t.merchantA, { profileFetchedAt: null })).id;
      const mine = new Set([
        namedFresh,
        namedStale,
        namelessRetry,
        picturelessRetry,
        neverRead,
        inactive,
        noConversation,
      ]);

      const listed = (await stale(t.merchantA)).map((row) => row.id).filter((id) => mine.has(id));

      expect(listed[0]).toBe(neverRead);
      expect(listed.sort()).toEqual(
        [namedStale, namelessRetry, picturelessRetry, neverRead].sort(),
      );
    });

    it('caps the batch', async () => {
      await customerWith(t.merchantA, { profileFetchedAt: null });
      await customerWith(t.merchantA, { profileFetchedAt: null });
      await expect(stale(t.merchantA, 1)).resolves.toHaveLength(1);
    });

    it("never lists another merchant's customers", async () => {
      const inB = await customerWith(t.merchantB, { profileFetchedAt: null });
      expect((await stale(t.merchantA)).map((row) => row.id)).not.toContain(inB);
      expect((await stale(t.merchantB)).map((row) => row.id)).toContain(inB);
    });

    it('filter, not policy: listStaleProfiles hides rows RLS would show when the scope is another merchant', async () => {
      const inA = await customerWith(t.merchantA, { profileFetchedAt: null });
      const listed = await as(t.merchantA, (tx) =>
        customers.listStaleProfiles(tx, scope(t.merchantB), {
          now,
          activeSince: daysAgo(30),
          limit: 200,
        }),
      );
      expect(listed.map((row) => row.id)).not.toContain(inA);
    });

    it('records a read, keeping what the read did not return', async () => {
      const { id } = await seedCustomer(t.db, t.merchantA, { name: 'Nusrat Jahan' });
      const pictureUrl = 'https://platform-lookaside.fbsbx.com/pic?oe=9';

      await expect(
        as(t.merchantA, (tx) =>
          customers.recordProfile(tx, scope(t.merchantA), id, {
            name: null,
            pictureUrl,
            fetchedAt: now,
          }),
        ),
      ).resolves.toBe(true);

      const [row] = await t.db.select().from(schema.customer).where(eq(schema.customer.id, id));
      expect(row).toMatchObject({ name: 'Nusrat Jahan', pictureUrl, profileFetchedAt: now });
    });

    it("filter, not policy: recordProfile leaves another merchant's customer alone", async () => {
      const { id } = await seedCustomer(t.db, t.merchantA, { profileFetchedAt: null });
      await expect(
        as(t.merchantA, (tx) =>
          customers.recordProfile(tx, scope(t.merchantB), id, {
            name: 'Intruder',
            pictureUrl: null,
            fetchedAt: now,
          }),
        ),
      ).resolves.toBe(false);
      const [row] = await t.db.select().from(schema.customer).where(eq(schema.customer.id, id));
      expect(row?.profileFetchedAt).toBeNull();
    });
  });

  describe('ConversationRepository ingest methods', () => {
    it('creates one thread per customer per Page and locks it', async () => {
      const customer = await seedCustomer(t.db, t.merchantA);
      const first = {
        sender: 'customer' as const,
        text: 'Is the blue kurti in M?',
        sentAt: at('2026-09-29T10:02:00Z'),
      };
      const created = await as(t.merchantA, (tx) =>
        conversations.lockOrCreate(tx, scope(t.merchantA), {
          facebookPageId: 'page-1',
          customerId: customer.id,
          first,
        }),
      );
      const again = await as(t.merchantA, (tx) =>
        conversations.lockOrCreate(tx, scope(t.merchantA), {
          facebookPageId: 'page-1',
          customerId: customer.id,
          first,
        }),
      );

      expect(again.id).toBe(created.id);
      expect(created).toMatchObject({
        state: 'browsing',
        botPaused: false,
        lastMessagePreview: 'Is the blue kurti in M?',
        lastMessageSender: 'customer',
        lastMessageAt: first.sentAt,
      });
    });

    it('moves the list columns forward, never back, and pauses on a seller message', async () => {
      const row = await seedConversation(t.db, t.merchantA, {
        lastMessageAt: at('2026-09-29T10:05:00Z'),
        lastInboundAt: at('2026-09-29T10:05:00Z'),
        lastMessagePreview: 'newer',
      });

      const late = await as(t.merchantA, (tx) =>
        conversations.applyMessage(tx, scope(t.merchantA), row, {
          sender: 'customer',
          text: 'older, delivered late',
          sentAt: at('2026-09-29T10:04:00Z'),
        }),
      );
      expect(late).toMatchObject({ lastMessagePreview: 'newer', lastInboundAt: row.lastInboundAt });

      const reply = await as(t.merchantA, (tx) =>
        conversations.applyMessage(tx, scope(t.merchantA), late, {
          sender: 'seller',
          text: 'Yes, it is',
          sentAt: at('2026-09-29T10:06:00Z'),
          pauseBot: true,
        }),
      );
      expect(reply).toMatchObject({
        lastMessagePreview: 'Yes, it is',
        lastMessageSender: 'seller',
        botPaused: true,
        lastInboundAt: row.lastInboundAt,
      });
    });

    it('filter, not policy: applyMessage cannot update a row under another merchant scope', async () => {
      const row = await seedConversation(t.db, t.merchantA, {
        lastMessageAt: at('2026-09-29T10:05:00Z'),
        lastInboundAt: at('2026-09-29T10:05:00Z'),
        lastMessagePreview: 'untouched',
      });

      await expect(
        as(t.merchantA, (tx) =>
          conversations.applyMessage(tx, scope(t.merchantB), row, {
            sender: 'seller',
            text: 'should not land',
            sentAt: at('2026-09-29T10:09:00Z'),
            pauseBot: true,
          }),
        ),
      ).rejects.toThrow('conversation update');

      const [after] = await t.db
        .select()
        .from(schema.conversation)
        .where(eq(schema.conversation.id, row.id));
      expect(after).toMatchObject({
        lastMessagePreview: 'untouched',
        lastMessageSender: row.lastMessageSender,
        botPaused: false,
        lastMessageAt: row.lastMessageAt,
      });
    });

    it("cannot lock another merchant's thread into existence", async () => {
      const customerOfA = await seedCustomer(t.db, t.merchantA);
      await expect(
        pgErrorOf(
          as(t.merchantB, (tx) =>
            conversations.lockOrCreate(tx, scope(t.merchantB), {
              facebookPageId: 'page-1',
              customerId: customerOfA.id,
              first: { sender: 'customer', text: 'x', sentAt: new Date() },
            }),
          ),
        ),
      ).resolves.toMatchObject({ code: '23503' });
    });
  });

  describe('MessageRepository.insertDelivered', () => {
    it('stores a Meta message once and answers null for a redelivery', async () => {
      const convo = await seedConversation(t.db, t.merchantA);
      const values = {
        conversationId: convo.id,
        sender: 'customer' as const,
        text: '2 pcs',
        metaMessageId: 'mid-redelivered',
        sentAt: at('2026-09-29T10:04:00Z'),
      };

      const stored = await as(t.merchantA, (tx) =>
        messages.insertDelivered(tx, scope(t.merchantA), values),
      );
      const redelivered = await as(t.merchantA, (tx) =>
        messages.insertDelivered(tx, scope(t.merchantA), values),
      );

      expect(stored).toMatchObject({ status: 'sent', text: '2 pcs' });
      expect(redelivered).toBeNull();
      expect(
        await t.db.select().from(schema.message).where(eq(schema.message.conversationId, convo.id)),
      ).toHaveLength(1);
    });

    it('treats the same Meta message id under two merchants as two messages, not a redelivery', async () => {
      const convoA = await seedConversation(t.db, t.merchantA);
      const convoB = await seedConversation(t.db, t.merchantB);
      const base = {
        sender: 'customer' as const,
        text: 'same mid',
        metaMessageId: 'mid-shared-across-merchants',
        sentAt: at('2026-09-29T10:04:00Z'),
      };

      const inA = await as(t.merchantA, (tx) =>
        messages.insertDelivered(tx, scope(t.merchantA), { ...base, conversationId: convoA.id }),
      );
      const inB = await as(t.merchantB, (tx) =>
        messages.insertDelivered(tx, scope(t.merchantB), { ...base, conversationId: convoB.id }),
      );

      expect(inA).not.toBeNull();
      expect(inB).toMatchObject({ merchantId: t.merchantB, conversationId: convoB.id });
      expect(inB?.id).not.toBe(inA?.id);
    });

    it("cannot store a message into another merchant's conversation", async () => {
      const convoOfA = await seedConversation(t.db, t.merchantA);
      await expect(
        pgErrorOf(
          as(t.merchantB, (tx) =>
            messages.insertDelivered(tx, scope(t.merchantB), {
              conversationId: convoOfA.id,
              sender: 'customer',
              text: 'x',
              metaMessageId: 'mid-into-a',
              sentAt: new Date(),
            }),
          ),
        ),
      ).resolves.toMatchObject({ code: '23503' });
    });
  });
});
