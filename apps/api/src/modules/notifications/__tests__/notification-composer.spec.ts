import { randomUUID } from 'node:crypto';
import { formatMinorUnits } from '@app/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AppConfig } from '../../config/app.config';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedMessage,
} from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import * as schema from '../../database/schema/index';
import { NotificationPreferencesRepository } from '../../settings/notification-preferences.repository';
import { ShopProfileRepository } from '../../settings/shop-profile.repository';
import { NotificationComposer } from '../notification-composer';
import { NotificationReadsRepository } from '../notification-reads.repository';

const APP_URL = 'https://app.example.test';
/** Intl puts a no-break space after the code, so build amounts the way the emails do. */
const bdt = (minor: number) => formatMinorUnits(minor, 'BDT', 'en-US');

// Runs as app_runtime, so row-level security applies exactly as in the worker.
describeDb('NotificationComposer', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let composer: NotificationComposer;
  const userIds: string[] = [];

  const seedMember = async (
    merchantId: string,
    switches: Partial<typeof schema.notificationPreference.$inferInsert> = {},
  ) => {
    const id = randomUUID().replaceAll('-', '');
    userIds.push(id);
    const email = `${id}@composer.example.test`;
    await t.db.insert(schema.user).values({ id, name: 'Rahim', email, emailVerified: true });
    await t.db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: merchantId,
      userId: id,
      role: 'owner',
      createdAt: new Date(),
    });
    if (Object.keys(switches).length > 0) {
      await t.db.insert(schema.notificationPreference).values({
        merchantId,
        userId: id,
        newOrder: true,
        customerWaiting: true,
        dailySummary: false,
        ...switches,
      });
    }
    return email;
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    composer = new NotificationComposer(
      runtime.db,
      { get: () => `${APP_URL}/` } as unknown as AppConfig,
      new NotificationReadsRepository(),
      new NotificationPreferencesRepository(),
      new ShopProfileRepository(),
    );
    await t.db
      .update(schema.organization)
      .set({ name: "Rahim's Kitchen" })
      .where(eq(schema.organization.id, t.merchantA));
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  afterEach(async () => {
    if (userIds.length > 0) {
      await t.db.delete(schema.user).where(inArray(schema.user.id, userIds));
      userIds.length = 0;
    }
    for (const merchantId of [t.merchantA, t.merchantB]) {
      await t.db.delete(schema.orderItem).where(eq(schema.orderItem.merchantId, merchantId));
      await t.db.delete(schema.order).where(eq(schema.order.merchantId, merchantId));
      await t.db.delete(schema.message).where(eq(schema.message.merchantId, merchantId));
      await t.db.delete(schema.conversation).where(eq(schema.conversation.merchantId, merchantId));
      await t.db.delete(schema.customer).where(eq(schema.customer.merchantId, merchantId));
      await t.db
        .delete(schema.merchantSettings)
        .where(eq(schema.merchantSettings.merchantId, merchantId));
    }
  });

  describe('orderDrafted', () => {
    it("writes one email per member who wants it, about the assistant's order", async () => {
      const owner = await seedMember(t.merchantA);
      await seedMember(t.merchantA, { newOrder: false });
      const customer = await seedCustomer(t.db, t.merchantA);
      const order = await seedOrder(t.db, t.merchantA, customer.id, { source: 'assistant' });

      const emails = await composer.orderDrafted(t.merchantA, order.id);

      expect(emails).toHaveLength(1);
      expect(emails[0]?.message.to).toBe(owner);
      expect(emails[0]?.message.subject).toBe(`New order ${order.reference}`);
      expect(emails[0]?.message.text).toContain(
        `Nusrat Jahan confirmed an order for ${bdt(100000)}`,
      );
      expect(emails[0]?.message.text).toContain("at Rahim's Kitchen");
      expect(emails[0]?.message.text).toContain(`${APP_URL}/orders/${order.id}`);
    });

    it('stays quiet about an order the seller added themselves', async () => {
      await seedMember(t.merchantA);
      const customer = await seedCustomer(t.db, t.merchantA);
      const order = await seedOrder(t.db, t.merchantA, customer.id, { source: 'seller' });

      await expect(composer.orderDrafted(t.merchantA, order.id)).resolves.toEqual([]);
    });

    it("finds nothing for another shop's order", async () => {
      await seedMember(t.merchantB);
      const customer = await seedCustomer(t.db, t.merchantA);
      const order = await seedOrder(t.db, t.merchantA, customer.id, { source: 'assistant' });

      await expect(composer.orderDrafted(t.merchantB, order.id)).resolves.toEqual([]);
    });
  });

  describe('customerWaiting', () => {
    const handedOffAt = new Date(Date.now() - 10 * 60 * 1000);

    it('writes the email while the chat is still handed off and unanswered', async () => {
      const owner = await seedMember(t.merchantA);
      const conversation = await seedConversation(t.db, t.merchantA, {
        state: 'handed_off',
        handedOffAt,
      });
      // A reply before the handoff doesn't count.
      await seedMessage(t.db, t.merchantA, conversation.id, {
        sender: 'seller',
        sentAt: new Date(handedOffAt.getTime() - 60_000),
      });

      const emails = await composer.customerWaiting(t.merchantA, conversation.id, handedOffAt);

      expect(emails.map((e) => e.message.to)).toEqual([owner]);
      expect(emails[0]?.message.subject).toBe('Nusrat Jahan is waiting for you');
      expect(emails[0]?.message.text).toContain(`${APP_URL}/conversations/${conversation.id}`);
    });

    it('stays quiet once the seller has replied', async () => {
      await seedMember(t.merchantA);
      const conversation = await seedConversation(t.db, t.merchantA, {
        state: 'handed_off',
        handedOffAt,
      });
      await seedMessage(t.db, t.merchantA, conversation.id, { sender: 'seller' });

      await expect(
        composer.customerWaiting(t.merchantA, conversation.id, handedOffAt),
      ).resolves.toEqual([]);
    });

    it('stays quiet once the chat is no longer handed off', async () => {
      await seedMember(t.merchantA);
      const conversation = await seedConversation(t.db, t.merchantA, { state: 'browsing' });

      await expect(
        composer.customerWaiting(t.merchantA, conversation.id, handedOffAt),
      ).resolves.toEqual([]);
    });

    it('stays quiet when the chat was handed off again since', async () => {
      await seedMember(t.merchantA);
      // Handed back and handed off again two minutes ago: that handoff has its own job.
      const conversation = await seedConversation(t.db, t.merchantA, {
        state: 'handed_off',
        handedOffAt: new Date(Date.now() - 2 * 60 * 1000),
      });

      await expect(
        composer.customerWaiting(t.merchantA, conversation.id, handedOffAt),
      ).resolves.toEqual([]);
    });

    it('stays quiet when nobody wants it', async () => {
      await seedMember(t.merchantA, { customerWaiting: false });
      const conversation = await seedConversation(t.db, t.merchantA, {
        state: 'handed_off',
        handedOffAt,
      });

      await expect(
        composer.customerWaiting(t.merchantA, conversation.id, handedOffAt),
      ).resolves.toEqual([]);
    });
  });

  describe('daily summary', () => {
    // 03:00 UTC is 9:00 in Dhaka, the default zone of a shop with no settings row.
    const scan = new Date('2026-10-07T03:00:00Z');

    it('is due for a shop at its 9:00 when someone turned it on', async () => {
      await seedMember(t.merchantA, { dailySummary: true });

      const due = await composer.dailySummariesDue(scan);

      expect(due).toContainEqual({ merchantId: t.merchantA, day: '2026-10-06' });
    });

    it('is not due when nobody turned it on, or at another hour', async () => {
      await seedMember(t.merchantB);
      await seedMember(t.merchantA, { dailySummary: true });

      const due = await composer.dailySummariesDue(scan);
      expect(due.map((d) => d.merchantId)).not.toContain(t.merchantB);

      const later = await composer.dailySummariesDue(new Date('2026-10-07T04:00:00Z'));
      expect(later.map((d) => d.merchantId)).not.toContain(t.merchantA);
    });

    it("uses the shop's own time zone", async () => {
      await seedMember(t.merchantA, { dailySummary: true });
      await t.db.insert(schema.merchantSettings).values({
        merchantId: t.merchantA,
        country: 'US',
        currency: 'USD',
        timeZone: 'America/New_York',
        dateFormat: 'MMM d, yyyy',
      });

      // 13:00 UTC is 9:00 in New York in October.
      const due = await composer.dailySummariesDue(new Date('2026-10-07T13:00:00Z'));
      expect(due).toContainEqual({ merchantId: t.merchantA, day: '2026-10-06' });
      expect((await composer.dailySummariesDue(scan)).map((d) => d.merchantId)).not.toContain(
        t.merchantA,
      );
    });

    it("totals the shop-local day's orders, leaving cancelled ones out of both", async () => {
      const owner = await seedMember(t.merchantA, { dailySummary: true });
      const customer = await seedCustomer(t.db, t.merchantA);
      // Dhaka is UTC+6: 6 Oct runs from 5 Oct 18:00 to 6 Oct 18:00 UTC.
      await seedOrder(t.db, t.merchantA, customer.id, {
        placedAt: new Date('2026-10-05T18:30:00Z'),
      });
      await seedOrder(t.db, t.merchantA, customer.id, {
        placedAt: new Date('2026-10-06T17:59:00Z'),
        status: 'cancelled',
      });
      // The next day in Dhaka, though still 6 Oct in UTC.
      await seedOrder(t.db, t.merchantA, customer.id, {
        placedAt: new Date('2026-10-06T18:00:00Z'),
      });

      const emails = await composer.dailySummary(t.merchantA, '2026-10-06');

      expect(emails.map((e) => e.message.to)).toEqual([owner]);
      expect(emails[0]?.message.subject).toBe("Rahim's Kitchen: 1 order on 6 Oct 2026");
      expect(emails[0]?.message.text).toContain(`for ${bdt(100000)} in revenue`);
    });

    it("sends nothing when the day's only orders were cancelled or returned", async () => {
      await seedMember(t.merchantA, { dailySummary: true });
      const customer = await seedCustomer(t.db, t.merchantA);
      for (const status of ['cancelled', 'returned'] as const) {
        await seedOrder(t.db, t.merchantA, customer.id, {
          placedAt: new Date('2026-10-06T06:00:00Z'),
          status,
        });
      }

      await expect(composer.dailySummary(t.merchantA, '2026-10-06')).resolves.toEqual([]);
    });

    it('sends nothing for a day without orders', async () => {
      await seedMember(t.merchantA, { dailySummary: true });

      await expect(composer.dailySummary(t.merchantA, '2026-10-06')).resolves.toEqual([]);
    });
  });
});
