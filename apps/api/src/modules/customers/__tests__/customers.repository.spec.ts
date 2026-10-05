import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/base.repository';
import { withMerchant } from '../../database/with-merchant';
import * as schema from '../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import { CustomerNotesRepository } from '../customer-notes.repository';
import { CustomersRepository, type CustomerListQuery } from '../customers.repository';

describeDb('customer repositories (app_runtime, two merchants)', () => {
  const customers = new CustomersRepository();
  const notes = new CustomerNotesRepository();
  let t: CatalogTestDb;
  let authorId: string;

  const now = new Date('2026-10-03T12:00:00.000Z');
  const hoursAgo = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000);
  const on = (date: string) => new Date(`${date}T10:00:00.000Z`);

  const as = <T>(merchantId: string, fn: (tx: Transaction) => Promise<T>) =>
    withMerchant(t.db, merchantId, async (tx) => {
      await tx.execute(sql`set local role app_runtime`);
      return fn(tx);
    });
  const scopeA = () => ({ merchantId: t.merchantA });

  let ids: Record<'nusrat' | 'tanvir' | 'sabbir' | 'shakil' | 'rakib' | 'jannat' | 'other', string>;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    const a = t.merchantA;

    // Repeat: three orders and a cancelled one that must not count.
    const nusrat = await seedCustomer(t.db, a, {
      name: 'Nusrat Jahan',
      phone: '01712-345678',
      area: 'Mirpur 10, Dhaka',
      deliveryAddress: 'House 12, Road 4, Mirpur 10, Dhaka',
      createdAt: on('2026-07-01'),
    });
    await seedConversation(t.db, a, {
      customerId: nusrat.id,
      lastMessageAt: hoursAgo(1),
      state: 'awaiting_confirmation',
    });
    await seedOrder(t.db, a, nusrat.id, {
      placedAt: hoursAgo(2),
      items: [{ productName: 'Blue kurti', variantName: 'M', quantity: 2, unitPrice: 163000 }],
    });
    await seedOrder(t.db, a, nusrat.id, {
      placedAt: on('2026-09-02'),
      status: 'delivered',
      items: [
        { productName: 'Cotton kurti', variantName: 'M', unitPrice: 168000 },
        { productName: 'Dupatta', variantName: null, unitPrice: 50000 },
      ],
    });
    await seedOrder(t.db, a, nusrat.id, {
      placedAt: on('2026-07-14'),
      status: 'delivered',
      items: [{ productName: 'Georgette saree', unitPrice: 330000 }],
    });
    await seedOrder(t.db, a, nusrat.id, {
      placedAt: hoursAgo(30),
      status: 'cancelled',
      items: [{ unitPrice: 999900 }],
    });

    // Needs you, with and without orders: handed off outranks everything.
    const tanvir = await seedCustomer(t.db, a, {
      name: 'Tanvir Ahmed',
      area: 'Uttara, Dhaka',
      createdAt: on('2026-09-25'),
    });
    await seedConversation(t.db, a, {
      customerId: tanvir.id,
      lastMessageAt: hoursAgo(4),
      state: 'handed_off',
    });
    await seedOrder(t.db, a, tanvir.id, { placedAt: hoursAgo(5), items: [{ unitPrice: 245000 }] });
    const sabbir = await seedCustomer(t.db, a, {
      name: 'Sabbir Hossain',
      createdAt: on('2026-09-28'),
    });
    await seedConversation(t.db, a, {
      customerId: sabbir.id,
      lastMessageAt: hoursAgo(6),
      state: 'handed_off',
    });
    // A returned order counts no more than a cancelled one: still "no orders".
    await seedOrder(t.db, a, sabbir.id, {
      placedAt: hoursAgo(8),
      status: 'returned',
      items: [{ unitPrice: 777700 }],
    });

    // Inactive: two orders, but nothing for more than 60 days.
    const shakil = await seedCustomer(t.db, a, {
      name: 'Shakil Khan',
      createdAt: on('2026-05-01'),
    });
    await seedConversation(t.db, a, { customerId: shakil.id, lastMessageAt: on('2026-07-20') });
    await seedOrder(t.db, a, shakil.id, {
      placedAt: on('2026-07-20'),
      items: [{ unitPrice: 182000 }],
    });
    await seedOrder(t.db, a, shakil.id, {
      placedAt: on('2026-07-10'),
      items: [{ unitPrice: 182000 }],
    });

    // New: one order, and none at all.
    const rakib = await seedCustomer(t.db, a, { name: 'Rakib Hasan', createdAt: on('2026-09-01') });
    await seedConversation(t.db, a, { customerId: rakib.id, lastMessageAt: on('2026-09-30') });
    await seedOrder(t.db, a, rakib.id, {
      placedAt: on('2026-09-30'),
      items: [{ unitPrice: 195000 }],
    });
    const jannat = await seedCustomer(t.db, a, { name: 'Jannat Ara', createdAt: on('2026-10-01') });

    // Merchant B: a namesake with big orders, which A must never see or count.
    const other = await seedCustomer(t.db, t.merchantB, {
      name: 'Nusrat Jahan',
      phone: '01712-345678',
      area: 'Mirpur 10, Dhaka',
    });
    await seedConversation(t.db, t.merchantB, { customerId: other.id, state: 'handed_off' });
    await seedOrder(t.db, t.merchantB, other.id, {
      placedAt: hoursAgo(1),
      items: [{ unitPrice: 5000000 }],
    });

    ids = {
      nusrat: nusrat.id,
      tanvir: tanvir.id,
      sabbir: sabbir.id,
      shakil: shakil.id,
      rakib: rakib.id,
      jannat: jannat.id,
      other: other.id,
    };

    authorId = randomUUID();
    await t.db.insert(schema.user).values({
      id: authorId,
      name: 'Rahim Uddin',
      email: `${authorId}@example.com`,
    });
  });

  afterAll(async () => {
    await t.close();
    await t.db
      .delete(schema.user)
      .where(eq(schema.user.id, authorId))
      .catch(() => {});
  });

  const listA = (query: Partial<CustomerListQuery> = {}) =>
    as(t.merchantA, (tx) =>
      customers.list(tx, scopeA(), {
        filter: 'all',
        sort: 'last_order',
        direction: 'desc',
        offset: 0,
        limit: 100,
        now,
        ...query,
      }),
    );
  const idsOf = (result: Awaited<ReturnType<typeof listA>>) =>
    result.rows.map((row) => row.customer.id);

  it("lists this merchant's customers only, newest order first, no-order customers last", async () => {
    const result = await listA();
    expect(result.total).toBe(6);
    const listed = idsOf(result);
    expect(listed.slice(0, 4)).toEqual([ids.nusrat, ids.tanvir, ids.rakib, ids.shakil]);
    expect(new Set(listed.slice(4))).toEqual(new Set([ids.sabbir, ids.jannat]));
    expect(listed).not.toContain(ids.other);
  });

  it('keeps customers without orders last when sorting ascending', async () => {
    const listed = idsOf(await listA({ direction: 'asc' }));
    expect(listed.slice(0, 4)).toEqual([ids.shakil, ids.rakib, ids.tanvir, ids.nusrat]);
  });

  it('derives order figures and status, leaving cancelled and returned orders out', async () => {
    const byId = new Map((await listA()).rows.map((row) => [row.customer.id, row]));
    expect(byId.get(ids.nusrat)).toMatchObject({
      orderCount: 3,
      totalSpent: 326000 + 218000 + 330000,
      lastOrderAt: hoursAgo(2),
      lastActiveAt: hoursAgo(1),
      status: 'repeat',
    });
    expect(byId.get(ids.tanvir)).toMatchObject({ orderCount: 1, status: 'needs_you' });
    expect(byId.get(ids.sabbir)).toMatchObject({
      orderCount: 0,
      totalSpent: 0,
      lastOrderAt: null,
      status: 'needs_you',
    });
    expect(byId.get(ids.shakil)).toMatchObject({ orderCount: 2, status: 'inactive' });
    expect(byId.get(ids.rakib)).toMatchObject({ orderCount: 1, status: 'new' });
    // No messages and no orders: last active is first contact.
    expect(byId.get(ids.jannat)).toMatchObject({
      orderCount: 0,
      lastActiveAt: on('2026-10-01'),
      status: 'new',
    });
  });

  it('filters by status', async () => {
    const filtered = async (filter: CustomerListQuery['filter']) =>
      new Set(idsOf(await listA({ filter })));
    expect(await filtered('needs_you')).toEqual(new Set([ids.tanvir, ids.sabbir]));
    expect(await filtered('inactive')).toEqual(new Set([ids.shakil]));
    expect(await filtered('repeat')).toEqual(new Set([ids.nusrat]));
    expect(await filtered('new')).toEqual(new Set([ids.rakib, ids.jannat]));
    expect((await listA({ filter: 'needs_you' })).total).toBe(2);
  });

  it('searches name, area and phone, digits matching a formatted number', async () => {
    const found = async (q: string) => idsOf(await listA({ q }));
    expect(await found('nusrat')).toEqual([ids.nusrat]);
    expect(await found('uttara')).toEqual([ids.tanvir]);
    expect(await found('01712-345678')).toEqual([ids.nusrat]);
    expect(await found('01712345678')).toEqual([ids.nusrat]);
    expect(await found('%')).toEqual([]);
  });

  it('sorts by order count and by total spent', async () => {
    expect(idsOf(await listA({ sort: 'orders' })).slice(0, 2)).toEqual([ids.nusrat, ids.shakil]);
    expect(idsOf(await listA({ sort: 'total_spent' })).slice(0, 4)).toEqual([
      ids.nusrat,
      ids.shakil,
      ids.tanvir,
      ids.rakib,
    ]);
  });

  it('pages with offset and limit, and counts the whole filtered set', async () => {
    const page = await listA({ offset: 2, limit: 2 });
    expect(page.total).toBe(6);
    expect(idsOf(page)).toEqual([ids.rakib, ids.shakil]);
  });

  it("finds a customer by id, never another merchant's", async () => {
    await expect(
      as(t.merchantA, (tx) => customers.findById(tx, scopeA(), ids.nusrat, now)),
    ).resolves.toMatchObject({ customer: { phone: '01712-345678' }, orderCount: 3 });
    await expect(
      as(t.merchantA, (tx) => customers.findById(tx, scopeA(), ids.other, now)),
    ).resolves.toBeNull();
    await expect(as(t.merchantA, (tx) => customers.exists(tx, scopeA(), ids.other))).resolves.toBe(
      false,
    );
  });

  it('summarizes this merchant only', async () => {
    const summary = await as(t.merchantA, (tx) => customers.summary(tx, scopeA(), now));
    expect(summary).toEqual({
      all: 6,
      needsYou: 2,
      inactive: 1,
      repeat: 1,
      new: 2,
      // Tanvir, Sabbir and Jannat first wrote within 30 days.
      newInWindow: 3,
      // Nusrat and Shakil, whatever their badge.
      repeatCustomers: 2,
      customersWithOrders: 4,
      averageOrderValue: {
        allTime: Math.round((326000 + 218000 + 330000 + 245000 + 182000 + 182000 + 195000) / 7),
        currentWindow: Math.round((326000 + 245000 + 195000) / 3),
        previousWindow: 218000,
      },
    });
  });

  it('lists a customer’s orders newest first with their items, cancelled included', async () => {
    const page = await as(t.merchantA, (tx) =>
      customers.listOrders(tx, scopeA(), ids.nusrat, { offset: 0, limit: 10 }),
    );
    expect(page.total).toBe(4);
    expect(page.rows.map((row) => row.order.status)).toEqual([
      'new',
      'cancelled',
      'delivered',
      'delivered',
    ]);
    expect(page.rows[2]?.items).toEqual([
      { productName: 'Cotton kurti', variantName: 'M', quantity: 1 },
      { productName: 'Dupatta', variantName: null, quantity: 1 },
    ]);
    const second = await as(t.merchantA, (tx) =>
      customers.listOrders(tx, scopeA(), ids.nusrat, { offset: 3, limit: 10 }),
    );
    expect(second.rows.map((row) => row.order.placedAt)).toEqual([on('2026-07-14')]);
  });

  it("never lists or edits another merchant's customer", async () => {
    await expect(
      as(t.merchantB, (tx) =>
        customers.listOrders(tx, { merchantId: t.merchantB }, ids.nusrat, { offset: 0, limit: 10 }),
      ),
    ).resolves.toEqual({ rows: [], total: 0 });
    await expect(
      as(t.merchantB, (tx) =>
        customers.updateContact(tx, { merchantId: t.merchantB }, ids.nusrat, { phone: '000' }),
      ),
    ).resolves.toBe(false);
    const [row] = await t.db
      .select({ phone: schema.customer.phone })
      .from(schema.customer)
      .where(eq(schema.customer.id, ids.nusrat));
    expect(row?.phone).toBe('01712-345678');
  });

  it('updates contact details, clearing with null', async () => {
    await expect(
      as(t.merchantA, (tx) =>
        customers.updateContact(tx, scopeA(), ids.jannat, {
          phone: '01913-990011',
          area: 'Bashundhara, Dhaka',
        }),
      ),
    ).resolves.toBe(true);
    await as(t.merchantA, (tx) =>
      customers.updateContact(tx, scopeA(), ids.jannat, { area: null }),
    );
    const found = await as(t.merchantA, (tx) => customers.findById(tx, scopeA(), ids.jannat, now));
    expect(found?.customer).toMatchObject({ phone: '01913-990011', area: null });
  });

  it('keeps notes per merchant, newest first, with their author', async () => {
    await as(t.merchantA, (tx) =>
      notes.insert(tx, scopeA(), { customerId: ids.rakib, authorId, body: 'First' }),
    );
    await as(t.merchantA, (tx) =>
      notes.insert(tx, scopeA(), { customerId: ids.rakib, authorId, body: 'Second' }),
    );
    const listed = await as(t.merchantA, (tx) => notes.list(tx, scopeA(), ids.rakib));
    expect(listed.map((row) => row.note.body)).toEqual(['Second', 'First']);
    expect(listed[0]?.author).toEqual({ id: authorId, name: 'Rahim Uddin' });
    await expect(
      as(t.merchantB, (tx) => notes.list(tx, { merchantId: t.merchantB }, ids.rakib)),
    ).resolves.toEqual([]);
  });
});
