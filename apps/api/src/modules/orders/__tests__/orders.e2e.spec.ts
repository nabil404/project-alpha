import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  deliveryQuoteSchema,
  orderDetailSchema,
  orderEventSchema,
  orderListResponseSchema,
  orderSummarySchema,
  type OrderDetail,
} from '@app/shared';
import request from 'supertest';
import { AuthModule } from '../../auth/auth.module';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { TenantGuard } from '../../../common/tenant.guard';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../database/database.module';
import * as schema from '../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import { MailService } from '../../mail/mail.service';
import { ProductsModule } from '../../products/products.module';
import { orderYear } from '../order-reference';
import { OrdersModule } from '../orders.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted, as the customer routes' spec does.
 * The app connects as app_runtime, so RLS applies; the tenant guard is stubbed
 * to a switchable merchant and the signed-in seller.
 */
describeDb('order routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  const seller = { id: randomUUID(), name: 'Rahim Uddin' };
  const server = () => app.getHttpServer();

  let nusratId: string;
  let productId: string;
  let kurtiM: string;
  let kurtiL: string;
  let draftedId: string;
  let otherOrderId: string;

  const stockOf = async (variantId: string) => {
    const [row] = await t.db
      .select({ stock: schema.productVariant.stock })
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, variantId));
    return row?.stock;
  };
  const revisionOf = async (id: string) => {
    const [row] = await t.db
      .select({ revision: schema.product.revision })
      .from(schema.product)
      .where(eq(schema.product.id, id));
    return row?.revision;
  };
  const get = async (id: string): Promise<OrderDetail> =>
    orderDetailSchema.parse((await request(server()).get(`/api/v1/orders/${id}`).expect(200)).body);
  const create = (body: Record<string, unknown>, key?: string) => {
    const req = request(server()).post('/api/v1/orders');
    if (key) req.set('Idempotency-Key', key);
    return req.send({ customerId: nusratId, deliveryFee: 6000, ...body });
  };
  /** The status alongside the body, so a failure shows the error envelope. */
  const ok = (res: request.Response) => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 200 });
    return res;
  };
  const move = async (id: string, status: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post(`/api/v1/orders/${id}/status`)
      .send({ status, version: (await get(id)).version, ...extra });

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    };

    @Global()
    @Module({
      providers: [
        { provide: DATABASE, useValue: runtime.db },
        { provide: AppConfig, useValue: { get: (key: string) => env[key] } },
      ],
      exports: [DATABASE, AppConfig],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestInfrastructureModule, AuthModule, OrdersModule, ProductsModule],
    })
      .overrideProvider(MailService)
      .useValue({ dispatch: () => {} })
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<Record<string, unknown>>();
          req.merchantId = merchantId;
          req.session = { user: seller, session: {} };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await app.init();

    await t.db.insert(schema.user).values({ ...seller, email: `${seller.id}@example.com` });
    const a = t.merchantA;
    const nusrat = await seedCustomer(t.db, a, {
      name: 'Nusrat Jahan',
      phone: '01712-345678',
      deliveryAddress: 'House 12, Road 4, Mirpur 10, Dhaka',
    });
    nusratId = nusrat.id;
    const product = await seedProduct(t.db, a, { name: 'Blue kurti', status: 'active' });
    productId = product.id;
    kurtiM = (await seedVariant(t.db, a, product.id, { name: 'M', price: 160000, stock: 3 })).id;
    kurtiL = (await seedVariant(t.db, a, product.id, { name: 'L', price: 170000, stock: 1 })).id;

    // An earlier, delivered order: history for the detail's customer figures.
    await seedOrder(t.db, a, nusrat.id, {
      status: 'delivered',
      placedAt: new Date('2026-09-01T10:00:00Z'),
      items: [{ unitPrice: 548000 }],
    });
    // Drafted by the assistant from a chat.
    const conversation = await seedConversation(t.db, a, { customerId: nusrat.id });
    const drafted = await seedOrder(t.db, a, nusrat.id, {
      conversationId: conversation.id,
      placedAt: new Date('2026-10-04T10:05:00Z'),
      deliveryFee: 6000,
      items: [{ productName: 'Blue kurti', variantName: 'M', quantity: 2, unitPrice: 160000 }],
    });
    await t.db
      .update(schema.orderItem)
      .set({ productId: product.id, variantId: kurtiM, sku: 'KUR-BLU-M' })
      .where(eq(schema.orderItem.orderId, drafted.id));
    draftedId = drafted.id;

    const other = await seedCustomer(t.db, t.merchantB, { name: 'Nusrat Jahan' });
    // From a long-gone year, so this year's numbering in the other shop starts empty.
    otherOrderId = (await seedOrder(t.db, t.merchantB, other.id, { year: 2000 })).id;
  });

  beforeEach(() => {
    merchantId = t.merchantA;
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.close();
    await t.close();
    await t.db
      .delete(schema.user)
      .where(eq(schema.user.id, seller.id))
      .catch(() => {});
  });

  it('gets an order with its lines, delivery snapshot and the customer’s history', async () => {
    const order = await get(draftedId);
    expect(order).toMatchObject({
      status: 'new',
      source: 'assistant',
      nextStatuses: ['confirmed', 'cancelled'],
      paymentStatus: 'unpaid',
      subtotal: 320000,
      deliveryFee: 6000,
      total: 326000,
      delivery: { name: 'Nusrat Jahan', phone: '01712-345678' },
      customer: { id: nusratId, earlierOrderCount: 1, spentBefore: 548000 },
    });
    expect(order.items).toEqual([
      expect.objectContaining({
        variantId: kurtiM,
        sku: 'KUR-BLU-M',
        quantity: 2,
        lineTotal: 320000,
      }),
    ]);
  });

  it("answers 404 ORDER_NOT_FOUND for another merchant's order, on every route", async () => {
    const base = `/api/v1/orders/${otherOrderId}`;
    for (const res of [
      await request(server()).get(base),
      await request(server()).get(`${base}/activity`),
      await request(server()).post(`${base}/status`).send({ status: 'confirmed', version: '0' }),
      await request(server())
        .put(`${base}/items`)
        .send({ items: [{ variantId: kurtiM, quantity: 1 }], version: '0' }),
      await request(server()).patch(base).send({ note: 'Hijacked', version: '0' }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'ORDER_NOT_FOUND' });
    }
    const [row] = await t.db
      .select({ status: schema.order.status, notes: schema.order.notes })
      .from(schema.order)
      .where(eq(schema.order.id, otherOrderId));
    expect(row).toEqual({ status: 'new', notes: null });
  });

  it('confirms: takes the stock, bumps the product, and records who did it', async () => {
    const revision = await revisionOf(productId);
    const res = await move(draftedId, 'confirmed').then(ok);
    expect(orderDetailSchema.parse(res.body)).toMatchObject({
      status: 'confirmed',
      nextStatuses: ['packed', 'cancelled'],
    });
    expect(await stockOf(kurtiM)).toBe(1);
    expect(await revisionOf(productId)).toBe((revision ?? 0) + 1);

    const activity = await request(server())
      .get(`/api/v1/orders/${draftedId}/activity`)
      .expect(200);
    expect(activity.body.map((event: unknown) => orderEventSchema.parse(event))).toEqual([
      expect.objectContaining({
        data: { type: 'status_changed', from: 'new', to: 'confirmed' },
        actor: seller,
      }),
    ]);
  });

  it('refuses a change made from an older read, and a move the lifecycle does not allow', async () => {
    const stale = await request(server())
      .post(`/api/v1/orders/${draftedId}/status`)
      .send({ status: 'packed', version: '0' })
      .expect(409);
    expect(stale.body.error.code).toBe('ORDER_STALE');
    const skip = await move(draftedId, 'delivered');
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      params: { from: 'confirmed', to: 'delivered' },
    });
  });

  it('edits a confirmed order’s items, moving only the stock difference', async () => {
    const { version } = await get(draftedId);
    const res = await request(server())
      .put(`/api/v1/orders/${draftedId}/items`)
      .send({
        version,
        items: [
          { variantId: kurtiM, quantity: 1 },
          { variantId: kurtiL, quantity: 1 },
        ],
      })
      .expect(200);
    const order = orderDetailSchema.parse(res.body);
    expect(order.items.map((item) => [item.variantName, item.quantity, item.unitPrice])).toEqual([
      ['M', 1, 160000],
      ['L', 1, 170000],
    ]);
    expect(order).toMatchObject({ subtotal: 330000, total: 336000 });
    expect(await stockOf(kurtiM)).toBe(2);
    expect(await stockOf(kurtiL)).toBe(0);
  });

  it('refuses taking more than is in stock, and changes nothing', async () => {
    const { version } = await get(draftedId);
    const res = await request(server())
      .put(`/api/v1/orders/${draftedId}/items`)
      .send({ version, items: [{ variantId: kurtiM, quantity: 9 }] })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'ORDER_INSUFFICIENT_STOCK',
      params: { variantId: kurtiM, name: 'Blue kurti, M', available: 2 },
    });
    expect(await stockOf(kurtiM)).toBe(2);
    expect(await stockOf(kurtiL)).toBe(0);
    expect((await get(draftedId)).version).toBe(version);
  });

  it('edits delivery, payment and tracking, then refuses delivery edits once shipped', async () => {
    const { version } = await get(draftedId);
    const res = await request(server())
      .patch(`/api/v1/orders/${draftedId}`)
      .send({
        version,
        deliveryAddress: 'House 14, Road 4, Mirpur 10, Dhaka',
        deliveryFee: 12000,
        paymentStatus: 'paid',
        note: 'Call before delivery',
      })
      .expect(200);
    expect(orderDetailSchema.parse(res.body)).toMatchObject({
      total: 342000,
      paymentStatus: 'paid',
      note: 'Call before delivery',
      delivery: { address: 'House 14, Road 4, Mirpur 10, Dhaka' },
    });
    const [customer] = await t.db
      .select({ address: schema.customer.deliveryAddress })
      .from(schema.customer)
      .where(eq(schema.customer.id, nusratId));
    expect(customer?.address).toBe('House 12, Road 4, Mirpur 10, Dhaka');

    await move(draftedId, 'packed').then(ok);
    await move(draftedId, 'shipped').then(ok);
    const shipped = await get(draftedId);
    const refused = await request(server())
      .patch(`/api/v1/orders/${draftedId}`)
      .send({ version: shipped.version, phone: '01812-000000' })
      .expect(409);
    expect(refused.body.error.code).toBe('ORDER_NOT_EDITABLE');
    await request(server())
      .patch(`/api/v1/orders/${draftedId}`)
      .send({ version: shipped.version, trackingNumber: 'PTH-123' })
      .expect(200);
  });

  it('gives the stock back when a shipped order is cancelled', async () => {
    const res = await move(draftedId, 'cancelled', { note: 'Customer refused' }).then(ok);
    expect(orderDetailSchema.parse(res.body).nextStatuses).toEqual([]);
    expect(await stockOf(kurtiM)).toBe(3);
    expect(await stockOf(kurtiL)).toBe(1);
  });

  it('adds an order by hand from the customer’s details on file, once per idempotency key', async () => {
    const key = randomUUID();
    const body = {
      items: [{ variantId: kurtiL, quantity: 1 }],
      deliveryArea: 'Local',
      paymentMethod: 'bank_transfer',
    };
    const first = orderDetailSchema.parse((await create(body, key).expect(201)).body);
    expect(first).toMatchObject({
      source: 'seller',
      status: 'new',
      paymentMethod: 'bank_transfer',
      currency: 'BDT',
      conversationId: null,
      total: 176000,
      delivery: {
        name: 'Nusrat Jahan',
        address: 'House 12, Road 4, Mirpur 10, Dhaka',
        area: 'Local',
      },
    });
    const replay = orderDetailSchema.parse((await create(body, key).expect(201)).body);
    expect(replay.id).toBe(first.id);
    const second = orderDetailSchema.parse((await create(body).expect(201)).body);
    expect(second).toMatchObject({ year: first.year, number: first.number + 1 });
    expect(second.reference).toBe(`ORD-${second.year}-${String(second.number).padStart(5, '0')}`);
    // Drafted, not confirmed: no stock moves yet.
    expect(await stockOf(kurtiL)).toBe(1);
  });

  it('numbers each year from 1 in the shop’s time zone, whatever other years and shops hold', async () => {
    merchantId = t.merchantB;
    const year = orderYear(new Date(), 'Asia/Dhaka');
    const rumana = await seedCustomer(t.db, t.merchantB, {
      name: 'Rumana Akter',
      phone: '01811-223344',
      deliveryAddress: 'Flat 3B, Road 7, Dhanmondi, Dhaka',
    });
    await seedOrder(t.db, t.merchantB, rumana.id, { year: year - 1, number: 900 });
    const scarf = await seedProduct(t.db, t.merchantB, { name: 'Silk scarf', status: 'active' });
    const variant = await seedVariant(t.db, t.merchantB, scarf.id, { price: 90000, stock: 5 });
    const place = async () =>
      orderDetailSchema.parse(
        (
          await request(server())
            .post('/api/v1/orders')
            .send({
              customerId: rumana.id,
              deliveryFee: 0,
              items: [{ variantId: variant.id, quantity: 1 }],
            })
            .expect(201)
        ).body,
      );

    const first = await place();
    expect(first).toMatchObject({ year, number: 1, reference: `ORD-${year}-00001` });
    expect(await place()).toMatchObject({ year, number: 2, reference: `ORD-${year}-00002` });
    // At once: the settings row lock hands each its own next number.
    const together = await Promise.all([place(), place(), place(), place()]);
    expect(together.map((order) => order.number).sort((x, y) => x - y)).toEqual([3, 4, 5, 6]);
  });

  it('refuses a hand-made order with no address to deliver to, or an archived variant', async () => {
    const bare = await seedCustomer(t.db, t.merchantA, { name: 'Tanvir Ahmed' });
    const res = await request(server())
      .post('/api/v1/orders')
      .send({ customerId: bare.id, deliveryFee: 0, items: [{ variantId: kurtiM, quantity: 1 }] })
      .expect(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['phone', 'deliveryAddress']);

    const archived = await seedVariant(t.db, t.merchantA, productId, {
      name: 'XL',
      archivedAt: new Date(),
    });
    const gone = await create({ items: [{ variantId: archived.id, quantity: 1 }] }).expect(404);
    expect(gone.body.error.code).toBe('VARIANT_NOT_FOUND');
    const duplicate = await create({
      items: [
        { variantId: kurtiM, quantity: 1 },
        { variantId: kurtiM, quantity: 2 },
      ],
    }).expect(400);
    expect(duplicate.body.error.fields['items.1.variantId'][0].code).toBe('DUPLICATE');
  });

  it('lists with search, status and dates, and the tabs count under the same filters', async () => {
    const all = orderListResponseSchema.parse(
      (await request(server()).get('/api/v1/orders').expect(200)).body,
    );
    expect(all.data.length).toBe(all.pagination.total);
    expect(all.data.every((row) => row.customer.id === nusratId)).toBe(true);

    const byReference = orderListResponseSchema.parse(
      (
        await request(server())
          .get('/api/v1/orders')
          .query({ q: (await get(draftedId)).reference })
          .expect(200)
      ).body,
    );
    expect(byReference.data.map((row) => row.id)).toEqual([draftedId]);
    expect(byReference.data[0]).toMatchObject({ status: 'cancelled', itemCount: 2 });

    const inOctober = { from: '2026-10-01T00:00:00+06:00', to: '2026-10-05T00:00:00+06:00' };
    const cancelled = orderListResponseSchema.parse(
      (
        await request(server())
          .get('/api/v1/orders')
          .query({ status: 'cancelled', ...inOctober })
          .expect(200)
      ).body,
    );
    expect(cancelled.data.map((row) => row.id)).toEqual([draftedId]);

    const summary = orderSummarySchema.parse(
      (await request(server()).get('/api/v1/orders/summary').query({ q: '01712' }).expect(200))
        .body,
    );
    expect(summary.counts).toMatchObject({ all: all.pagination.total, cancelled: 1, delivered: 1 });
    expect(summary.awaitingConfirmation).toBe(2);
    expect(summary.placedInWindow.byAssistant).toBeLessThan(summary.placedInWindow.all);

    await request(server())
      .get('/api/v1/orders')
      .query({ from: inOctober.to, to: inOctober.from })
      .expect(400);
  });

  it('finds an order by its reference, whole, unpadded or in part, or by its bare number in any year', async () => {
    const drafted = await get(draftedId);
    const in2024 = await seedOrder(t.db, t.merchantA, nusratId, { year: 2024, number: 7777 });
    const in2025 = await seedOrder(t.db, t.merchantA, nusratId, { year: 2025, number: 7777 });
    // Another shop's order with a reference this shop does not have.
    await seedOrder(t.db, t.merchantB, (await seedCustomer(t.db, t.merchantB)).id, {
      year: 2026,
      number: 4242,
    });
    const search = async (q: string) =>
      orderListResponseSchema
        .parse((await request(server()).get('/api/v1/orders').query({ q }).expect(200)).body)
        .data.map((row) => row.id)
        .sort();

    expect(await search(drafted.reference.toLowerCase())).toEqual([draftedId]);
    expect(await search('ORD-2025-7777')).toEqual([in2025.id]);
    expect(await search('ORD-2025')).toEqual([in2025.id]);
    expect(await search('2024-07')).toEqual([in2024.id]);
    expect(await search('#7777')).toEqual([in2024.id, in2025.id].sort());
    // Digits alone match the number exactly, not part of it.
    expect(await search('777')).toEqual([]);
    expect(await search('ORD-2026-04242')).toEqual([]);
  });

  it('refuses to delete a product that was ordered', async () => {
    const res = await request(server()).delete(`/api/v1/products/${productId}`).expect(409);
    expect(res.body.error.code).toBe('PRODUCT_IN_USE');
  });
  describe('delivery areas', () => {
    const seedArea = async (
      values: Partial<typeof schema.deliveryCharge.$inferInsert>,
      merchant = merchantId,
    ) => {
      const [row] = await t.db
        .insert(schema.deliveryCharge)
        .values({ merchantId: merchant, areaName: null, charge: 0, position: 0, ...values })
        .returning();
      if (!row) throw new Error('no delivery_charge row');
      return row;
    };
    const items = () => [{ variantId: kurtiM, quantity: 1 }];
    let dhakaId: string;
    let gazipurId: string;
    let elsewhereId: string;

    beforeAll(async () => {
      dhakaId = (await seedArea({ areaName: 'Dhaka', charge: 6000, deliveryTime: '1–2 days' })).id;
      gazipurId = (await seedArea({ areaName: 'Gazipur', charge: 8000, position: 1 })).id;
      elsewhereId = (await seedArea({ isFallback: true, charge: 12000, deliveryTime: '3–5 days' }))
        .id;
    });

    it('links an area and keeps its name and estimate', async () => {
      const res = await create({ items: items(), deliveryChargeId: dhakaId }).expect(201);
      expect(orderDetailSchema.parse(res.body)).toMatchObject({
        deliveryFee: 6000,
        delivery: { area: 'Dhaka', chargeId: dhakaId, everywhereElse: false, time: '1–2 days' },
      });
    });

    it('marks an order priced at everywhere else', async () => {
      const res = await create({
        items: items(),
        deliveryChargeId: elsewhereId,
        deliveryFee: 12000,
      }).expect(201);
      expect(orderDetailSchema.parse(res.body).delivery).toMatchObject({
        area: null,
        chargeId: elsewhereId,
        everywhereElse: true,
        time: '3–5 days',
      });
    });

    it('moves the area with PATCH, then unlinks it', async () => {
      const order = orderDetailSchema.parse(
        (await create({ items: items(), deliveryChargeId: dhakaId }).expect(201)).body,
      );
      const moved = await request(server())
        .patch(`/api/v1/orders/${order.id}`)
        .send({ version: order.version, deliveryChargeId: gazipurId, deliveryFee: 8000 })
        .expect(200);
      expect(orderDetailSchema.parse(moved.body)).toMatchObject({
        deliveryFee: 8000,
        delivery: { area: 'Gazipur', chargeId: gazipurId, time: null },
      });

      const cleared = await request(server())
        .patch(`/api/v1/orders/${order.id}`)
        .send({ version: moved.body.version, deliveryChargeId: null })
        .expect(200);
      expect(orderDetailSchema.parse(cleared.body).delivery).toMatchObject({
        area: null,
        chargeId: null,
        everywhereElse: false,
        time: null,
      });
    });

    it('keeps an order readable after its area is removed', async () => {
      const savar = await seedArea({
        areaName: 'Savar',
        charge: 9000,
        deliveryTime: '2 days',
        position: 2,
      });
      const order = orderDetailSchema.parse(
        (await create({ items: items(), deliveryChargeId: savar.id }).expect(201)).body,
      );
      await t.db.delete(schema.deliveryCharge).where(eq(schema.deliveryCharge.id, savar.id));
      expect((await get(order.id)).delivery).toMatchObject({
        area: 'Savar',
        chargeId: null,
        time: '2 days',
      });
    });

    it("refuses another shop's area", async () => {
      const theirs = await seedArea({ areaName: 'Dhaka', charge: 1 }, t.merchantB);
      const res = await create({ items: items(), deliveryChargeId: theirs.id }).expect(404);
      expect(res.body.error.code).toBe('DELIVERY_CHARGE_NOT_FOUND');
    });

    it('quotes the fee for items to an area, and validates the request', async () => {
      const quoted = await request(server())
        .post('/api/v1/orders/delivery-quote')
        .send({ deliveryChargeId: gazipurId, items: items() })
        .expect(200);
      expect(deliveryQuoteSchema.parse(quoted.body)).toMatchObject({
        fee: 8000,
        freeDeliveryApplied: false,
      });

      await request(server())
        .post('/api/v1/orders/delivery-quote')
        .send({ deliveryChargeId: 'nope', items: items() })
        .expect(400);
    });
  });
});
