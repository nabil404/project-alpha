import { eq } from 'drizzle-orm';
import {
  orderEventTypes,
  orderSources,
  orderStatuses,
  paymentMethods,
  paymentStatuses,
} from '@app/shared';
import { withMerchant } from '../with-merchant';
import * as schema from '../schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  pgErrorOf,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from './catalog-test-db';
import { seedConversation, seedCustomer } from './conversation-seeds';
import { seedOrder } from './order-seeds';

describe('order enum columns', () => {
  it('match the shared enums', () => {
    expect(schema.order.status.enumValues).toEqual([...orderStatuses]);
    expect(schema.order.source.enumValues).toEqual([...orderSources]);
    expect(schema.order.paymentStatus.enumValues).toEqual([...paymentStatuses]);
    expect(schema.order.paymentMethod.enumValues).toEqual([...paymentMethods]);
    expect(schema.orderEvent.type.enumValues).toEqual([...orderEventTypes]);
  });
});

describeDb('order and customer note schema constraints', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it("rejects an order on another merchant's customer or conversation", async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    const customerOfB = await seedCustomer(t.db, t.merchantB);
    const conversationOfA = await seedConversation(t.db, t.merchantA, {
      customerId: customerOfA.id,
    });
    await expect(pgErrorOf(seedOrder(t.db, t.merchantB, customerOfA.id))).resolves.toEqual({
      code: '23503',
      constraint: 'order_customer_fk',
    });
    await expect(
      pgErrorOf(
        seedOrder(t.db, t.merchantB, customerOfB.id, { conversationId: conversationOfA.id }),
      ),
    ).resolves.toEqual({ code: '23503', constraint: 'order_conversation_fk' });
  });

  it('numbers orders once per merchant, and the same number in two shops', async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    const customerOfB = await seedCustomer(t.db, t.merchantB);
    await seedOrder(t.db, t.merchantA, customerOfA.id, { number: 9001 });
    await expect(
      pgErrorOf(seedOrder(t.db, t.merchantA, customerOfA.id, { number: 9001 })),
    ).resolves.toEqual({ code: '23505', constraint: schema.ORDER_NUMBER_UQ });
    await expect(
      seedOrder(t.db, t.merchantB, customerOfB.id, { number: 9001 }),
    ).resolves.toBeTruthy();
  });

  it('refuses a total that is not subtotal plus delivery', async () => {
    const customer = await seedCustomer(t.db, t.merchantA);
    await expect(
      pgErrorOf(seedOrder(t.db, t.merchantA, customer.id, { total: 1 })),
    ).resolves.toEqual({ code: '23514', constraint: 'order_amounts_ck' });
  });

  it("rejects a line on another merchant's variant, and an event whose type disagrees with its data", async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    const productOfB = await seedProduct(t.db, t.merchantB);
    const variantOfB = await seedVariant(t.db, t.merchantB, productOfB.id);
    const orderOfA = await seedOrder(t.db, t.merchantA, customerOfA.id);
    await expect(
      pgErrorOf(
        t.db
          .update(schema.orderItem)
          .set({ variantId: variantOfB.id })
          .where(eq(schema.orderItem.orderId, orderOfA.id)),
      ),
    ).resolves.toEqual({ code: '23503', constraint: 'order_item_variant_fk' });
    await expect(
      pgErrorOf(
        t.db.insert(schema.orderEvent).values({
          merchantId: t.merchantA,
          orderId: orderOfA.id,
          type: 'created',
          data: { type: 'status_changed', from: 'new', to: 'confirmed' },
        }),
      ),
    ).resolves.toEqual({ code: '23514', constraint: 'order_event_data_type_ck' });
  });

  it("rejects a note on another merchant's customer", async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    await expect(
      pgErrorOf(
        t.db.insert(schema.customerNote).values({
          merchantId: t.merchantB,
          customerId: customerOfA.id,
          body: 'Prefers delivery after 5 pm',
        }),
      ),
    ).resolves.toEqual({ code: '23503', constraint: 'customer_note_customer_fk' });
  });

  it('shows the runtime role only the current merchant’s orders, items and notes', async () => {
    const customerOfA = await seedCustomer(t.db, t.merchantA);
    const customerOfB = await seedCustomer(t.db, t.merchantB);
    const orderOfA = await seedOrder(t.db, t.merchantA, customerOfA.id);
    await seedOrder(t.db, t.merchantB, customerOfB.id);
    await t.db
      .insert(schema.customerNote)
      .values({ merchantId: t.merchantB, customerId: customerOfB.id, body: 'B only' });
    const orderOfB = await seedOrder(t.db, t.merchantB, customerOfB.id);
    await t.db.insert(schema.orderEvent).values({
      merchantId: t.merchantB,
      orderId: orderOfB.id,
      type: 'created',
      data: { type: 'created', source: 'seller' },
    });

    const seen = await withMerchant(runtime.db, t.merchantA, async (tx) => ({
      orders: await tx.select({ merchantId: schema.order.merchantId }).from(schema.order),
      items: await tx
        .select({ merchantId: schema.orderItem.merchantId, orderId: schema.orderItem.orderId })
        .from(schema.orderItem),
      notes: await tx
        .select({ merchantId: schema.customerNote.merchantId })
        .from(schema.customerNote),
      events: await tx.select({ merchantId: schema.orderEvent.merchantId }).from(schema.orderEvent),
    }));
    expect(new Set(seen.orders.map((row) => row.merchantId))).toEqual(new Set([t.merchantA]));
    expect(new Set(seen.items.map((row) => row.merchantId))).toEqual(new Set([t.merchantA]));
    expect(seen.items.map((row) => row.orderId)).toContain(orderOfA.id);
    expect(seen.notes).toEqual([]);
    expect(seen.events).toEqual([]);

    // Without merchant context, nothing at all.
    await expect(runtime.db.select().from(schema.order)).resolves.toEqual([]);

    // An update aimed at another merchant's rows finds none to change.
    const changed = await withMerchant(runtime.db, t.merchantA, (tx) =>
      tx
        .update(schema.order)
        .set({ notes: 'hijack' })
        .where(eq(schema.order.merchantId, t.merchantB))
        .returning(),
    );
    expect(changed).toEqual([]);
  });
});
