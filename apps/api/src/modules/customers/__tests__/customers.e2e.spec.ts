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
  customerDetailSchema,
  customerListResponseSchema,
  customerNoteSchema,
  customerOrderPageSchema,
  customerSummarySchema,
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
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import { MailService } from '../../mail/mail.service';
import { CustomersModule } from '../customers.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted, as the category routes' spec does.
 * The app connects as app_runtime, so RLS applies; the tenant guard is stubbed
 * to a switchable merchant and the signed-in seller.
 */
describeDb('customer routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  const seller = { id: randomUUID(), name: 'Rahim Uddin' };
  const server = () => app.getHttpServer();
  let nusratId: string;
  let otherId: string;

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
      imports: [TestInfrastructureModule, AuthModule, CustomersModule],
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
    const nusrat = await seedCustomer(t.db, t.merchantA, {
      name: 'Nusrat Jahan',
      phone: '01712-345678',
      area: 'Mirpur 10, Dhaka',
    });
    await seedConversation(t.db, t.merchantA, { customerId: nusrat.id, state: 'handed_off' });
    await seedOrder(t.db, t.merchantA, nusrat.id, {
      items: [{ productName: 'Blue kurti', quantity: 2, unitPrice: 163000 }],
    });
    nusratId = nusrat.id;
    otherId = (await seedCustomer(t.db, t.merchantB, { name: 'Nusrat Jahan' })).id;
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

  it('lists with page pagination and the customer figures', async () => {
    const res = await request(server())
      .get('/api/v1/customers')
      .query({ q: 'nusrat', pageSize: 25 })
      .expect(200);
    const body = customerListResponseSchema.parse(res.body);
    expect(body.pagination).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(body.data).toEqual([
      expect.objectContaining({
        id: nusratId,
        phone: '01712-345678',
        status: 'needs_you',
        orderCount: 1,
        totalSpent: 326000,
      }),
    ]);
  });

  it('refuses a page size the page does not offer, and an unknown sort', async () => {
    const res = await request(server()).get('/api/v1/customers?pageSize=7').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    await request(server()).get('/api/v1/customers?sort=psid').expect(400);
  });

  it('summarizes the stat cards', async () => {
    const res = await request(server()).get('/api/v1/customers/summary').expect(200);
    const body = customerSummarySchema.parse(res.body);
    expect(body.counts).toMatchObject({ all: 1, needsYou: 1 });
    expect(body.averageOrderValue.allTime).toBe(326000);
  });

  it('gets a customer with their latest conversation', async () => {
    const res = await request(server()).get(`/api/v1/customers/${nusratId}`).expect(200);
    const body = customerDetailSchema.parse(res.body);
    expect(body).toMatchObject({
      averageOrderValue: 326000,
      latestConversation: { state: 'handed_off' },
    });
  });

  it("answers 404 CUSTOMER_NOT_FOUND for another merchant's customer, on every route", async () => {
    const base = `/api/v1/customers/${otherId}`;
    for (const res of [
      await request(server()).get(base),
      await request(server()).patch(base).send({ area: 'Hijacked' }),
      await request(server()).get(`${base}/orders`),
      await request(server()).get(`${base}/notes`),
      await request(server()).post(`${base}/notes`).send({ body: 'Hijacked' }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'CUSTOMER_NOT_FOUND', params: { id: otherId } });
    }
    const [row] = await t.db
      .select({ area: schema.customer.area })
      .from(schema.customer)
      .where(eq(schema.customer.id, otherId));
    expect(row?.area).toBeNull();
  });

  it('edits contact details, a blank field clearing it, and refuses a bad phone', async () => {
    const res = await request(server())
      .patch(`/api/v1/customers/${nusratId}`)
      .send({ area: '  ', deliveryAddress: 'House 12, Road 4, Mirpur 10, Dhaka' })
      .expect(200);
    expect(customerDetailSchema.parse(res.body)).toMatchObject({
      area: null,
      phone: '01712-345678',
      deliveryAddress: 'House 12, Road 4, Mirpur 10, Dhaka',
    });
    const bad = await request(server())
      .patch(`/api/v1/customers/${nusratId}`)
      .send({ phone: 'call me' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await request(server()).patch(`/api/v1/customers/${nusratId}`).send({ name: 'x' }).expect(400);
  });

  it('lists the customer’s orders with their items', async () => {
    const res = await request(server()).get(`/api/v1/customers/${nusratId}/orders`).expect(200);
    const body = customerOrderPageSchema.parse(res.body);
    expect(body.pagination.total).toBe(1);
    expect(body.data[0]?.items).toEqual([
      { productName: 'Blue kurti', variantName: 'M', quantity: 2 },
    ]);
  });

  it('adds a note as the signed-in seller and lists it', async () => {
    const created = await request(server())
      .post(`/api/v1/customers/${nusratId}/notes`)
      .send({ body: '  Prefers delivery after 5 pm.  ' })
      .expect(201);
    const note = customerNoteSchema.parse(created.body);
    expect(note).toMatchObject({ body: 'Prefers delivery after 5 pm.', author: seller });

    const listed = await request(server()).get(`/api/v1/customers/${nusratId}/notes`).expect(200);
    expect(listed.body).toEqual([note]);
    await request(server())
      .post(`/api/v1/customers/${nusratId}/notes`)
      .send({ body: '   ' })
      .expect(400);
  });
});
