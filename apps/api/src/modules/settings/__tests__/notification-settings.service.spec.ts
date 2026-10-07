import { randomUUID } from 'node:crypto';
import { NOTIFICATION_DEFAULTS } from '@app/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import * as schema from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import { NotificationPreferencesRepository } from '../notification-preferences.repository';
import { NotificationSettingsService } from '../notification-settings.service';

// Runs as app_runtime, so row-level security applies exactly as in the api.
describeDb('NotificationSettingsService', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let service: NotificationSettingsService;
  const repository = new NotificationPreferencesRepository();
  const userIds: string[] = [];

  /** A person who belongs to `merchantId`, as Better Auth would leave them. */
  const seedMember = async (merchantId: string, emailVerified = true) => {
    const id = randomUUID().replaceAll('-', '');
    userIds.push(id);
    await t.db.insert(schema.user).values({
      id,
      name: `Seller ${id.slice(0, 6)}`,
      email: `${id}@notifications.example.test`,
      emailVerified,
    });
    await t.db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: merchantId,
      userId: id,
      role: 'owner',
      createdAt: new Date(),
    });
    return id;
  };

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    service = new NotificationSettingsService(runtime.db, repository);
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  afterEach(async () => {
    // member and notification_preference cascade from user.
    if (userIds.length > 0) {
      await t.db.delete(schema.user).where(inArray(schema.user.id, userIds));
      userIds.length = 0;
    }
  });

  const scopeA = () => ({ merchantId: t.merchantA });

  it('reads as the defaults until the first toggle, and writes no row', async () => {
    const userId = await seedMember(t.merchantA);

    await expect(service.get(scopeA(), userId)).resolves.toEqual(NOTIFICATION_DEFAULTS);
    await expect(service.update(scopeA(), userId, {})).resolves.toEqual(NOTIFICATION_DEFAULTS);

    const rows = await t.db
      .select()
      .from(schema.notificationPreference)
      .where(eq(schema.notificationPreference.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it('fills a first write from the defaults and keeps unsent switches on later ones', async () => {
    const userId = await seedMember(t.merchantA);

    await expect(service.update(scopeA(), userId, { dailySummary: true })).resolves.toEqual({
      newOrder: true,
      customerWaiting: true,
      dailySummary: true,
    });
    await expect(service.update(scopeA(), userId, { newOrder: false })).resolves.toEqual({
      newOrder: false,
      customerWaiting: true,
      dailySummary: true,
    });
    await expect(service.get(scopeA(), userId)).resolves.toEqual({
      newOrder: false,
      customerWaiting: true,
      dailySummary: true,
    });
  });

  it("keeps two members' switches apart within one shop", async () => {
    const owner = await seedMember(t.merchantA);
    const teammate = await seedMember(t.merchantA);

    await service.update(scopeA(), owner, { newOrder: false });

    await expect(service.get(scopeA(), teammate)).resolves.toEqual(NOTIFICATION_DEFAULTS);
  });

  it("keeps one person's switches apart across their two shops", async () => {
    const userId = await seedMember(t.merchantA);
    await t.db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: t.merchantB,
      userId,
      role: 'owner',
      createdAt: new Date(),
    });

    await service.update(scopeA(), userId, { customerWaiting: false });

    await expect(service.get({ merchantId: t.merchantB }, userId)).resolves.toEqual(
      NOTIFICATION_DEFAULTS,
    );
  });

  it("never reads or writes another shop's rows", async () => {
    const userId = await seedMember(t.merchantA);
    await service.update(scopeA(), userId, { dailySummary: true });

    const seen = await withMerchant(runtime.db, t.merchantB, (tx) =>
      tx.select().from(schema.notificationPreference),
    );
    expect(seen).toHaveLength(0);

    // A write scoped to shop B under shop A's context is refused by the policy.
    await expect(
      withMerchant(runtime.db, t.merchantA, (tx) =>
        repository.upsert(tx, { merchantId: t.merchantB }, userId, { newOrder: false }),
      ),
    ).rejects.toThrow();
  });

  describe('recipients', () => {
    const recipients = (kind: Parameters<typeof repository.recipients>[2]) =>
      withMerchant(runtime.db, t.merchantA, (tx) => repository.recipients(tx, scopeA(), kind));

    it('lists members with the switch on, counting no row as the default', async () => {
      const untouched = await seedMember(t.merchantA);
      const optedOut = await seedMember(t.merchantA);
      const optedIn = await seedMember(t.merchantA);
      await service.update(scopeA(), optedOut, { newOrder: false });
      await service.update(scopeA(), optedIn, { dailySummary: true });

      const newOrder = (await recipients('newOrder')).map((r) => r.userId);
      expect(newOrder.sort()).toEqual([untouched, optedIn].sort());

      const daily = (await recipients('dailySummary')).map((r) => r.userId);
      expect(daily).toEqual([optedIn]);
    });

    it('skips an unverified address', async () => {
      const verified = await seedMember(t.merchantA);
      await seedMember(t.merchantA, false);

      const found = await recipients('customerWaiting');

      expect(found).toEqual([
        {
          userId: verified,
          email: `${verified}@notifications.example.test`,
        },
      ]);
    });

    it("never lists another shop's members", async () => {
      await seedMember(t.merchantB);

      await expect(recipients('newOrder')).resolves.toEqual([]);
    });
  });

  it('forces row-level security on the table', async () => {
    const { rows } = await t.db.execute<{ force: boolean }>(sql`
      select relforcerowsecurity as force from pg_class where relname = 'notification_preference'`);
    expect(rows).toEqual([{ force: true }]);
  });
});
