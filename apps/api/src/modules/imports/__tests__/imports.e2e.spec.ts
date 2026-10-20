import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  importPostListResponseSchema,
  importRunListResponseSchema,
  importRunSchema,
  shopToday,
} from '@app/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { listenOnLoopback } from '../../../__tests__/listen-on-loopback';
import { describeDb, testDatabaseUrl } from '../../../__tests__/test-env';
import { CryptoService } from '../../../common/crypto.service';
import { CapturingMailer } from '../../auth/__tests__/capturing-mailer';
import { AuthModule } from '../../auth/auth.module';
import { SessionGuard } from '../../auth/session.guard';
import { AppConfig } from '../../config/app.config';
import { seedProduct, seedVariant } from '../../database/__tests__/catalog-test-db';
import { seedFacebookPage } from '../../database/__tests__/conversation-seeds';
import { DATABASE, type Database } from '../../database/database.module';
import * as schema from '../../database/schema/index';
import { MailService } from '../../mail/mail.service';
import { FacebookPageModule } from '../../messenger/page/facebook-page.module';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { META_GRAPH } from '../../messenger/page/facebook-page.tokens';
import { GraphError } from '../../messenger/page/meta-graph.client';
import { FakeQueue } from '../../queue/__tests__/fake-queue.module';
import { QueueModule } from '../../queue/queue.module';
import {
  IMPORT_POST_JOB,
  IMPORT_RUN_JOB,
  IMPORTS_QUEUE,
  MESSENGER_PROFILE_QUEUE,
} from '../../queue/queue.constants';
import { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { dayAfter } from '../import-runner';
import { ImportsModule } from '../imports.module';

// Needs a real Postgres: sessions come from Better Auth.
const url = testDatabaseUrl;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const KEY = Buffer.alloc(32, 7).toString('base64');
const crypto = new CryptoService({ get: () => KEY } as unknown as AppConfig);
const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

const graph = {
  refuse: null as GraphError | null,
  listPublishedPosts: async () => {
    if (graph.refuse) throw graph.refuse;
    return { posts: [], after: null };
  },
};

@Module({
  providers: [FacebookPageRepository, { provide: META_GRAPH, useValue: graph }],
  exports: [FacebookPageRepository, META_GRAPH],
})
class FakePageModule {}

const importsQueue = new FakeQueue();

@Module({
  providers: [
    { provide: getQueueToken(IMPORTS_QUEUE), useValue: importsQueue },
    { provide: getQueueToken(MESSENGER_PROFILE_QUEUE), useValue: new FakeQueue() },
  ],
  exports: [getQueueToken(IMPORTS_QUEUE), getQueueToken(MESSENGER_PROFILE_QUEUE)],
})
class FakeQueuesModule {}

describeDb('Imports over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    APP_URL,
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    TOKEN_ENCRYPTION_KEY: KEY,
    LLM_API_KEY: 'sk-test',
  };

  const server = () => app.getHttpServer();
  const today = shopToday('Asia/Dhaka');
  const range = { source: 'facebook_posts', since: '2026-07-01', until: today };

  const verifiedSellerWithShop = async () => {
    const address = `seller-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName: "Nadia's Sarees",
        phone: '+880 1712-345678',
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    const session = await agent.get('/api/v1/auth/get-session').expect(200);
    return { agent, merchantId: session.body.session.activeOrganizationId as string };
  };

  const connected = async () => {
    const seller = await verifiedSellerWithShop();
    await seedFacebookPage(db, seller.merchantId, { accessToken: crypto.encrypt('page-token') });
    return seller;
  };

  const seedRun = async (
    merchantId: string,
    status: 'running' | 'stopped' | 'finished' = 'finished',
  ) => {
    const [run] = await db
      .insert(schema.productImport)
      .values({
        merchantId,
        source: 'facebook_posts',
        since: '2026-07-01',
        until: '2026-08-01',
        status,
      })
      .returning();
    return run!;
  };

  const seedPost = async (
    merchantId: string,
    importId: string,
    values: Partial<typeof schema.productImportPost.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.productImportPost)
      .values({
        merchantId,
        importId,
        postId: `1_${randomUUID()}`,
        result: 'not_product',
        ...values,
      })
      .returning();
    return row!;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });

    @Global()
    @Module({
      providers: [
        { provide: DATABASE, useValue: db },
        { provide: AppConfig, useValue: { get: (key: string) => env[key] } },
      ],
      exports: [DATABASE, AppConfig],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestInfrastructureModule, AuthModule, ImportsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideModule(QueueModule)
      .useModule(FakeQueuesModule)
      .overrideModule(FacebookPageModule)
      .useModule(FakePageModule)
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .overrideProvider(MailService)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await listenOnLoopback(app);
  });

  beforeEach(() => {
    graph.refuse = null;
    env.LLM_API_KEY = 'sk-test';
    importsQueue.added = [];
  });

  afterAll(async () => {
    await app?.close();
    const userIds = (
      await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(like(schema.user.email, `%@${EMAIL_DOMAIN}`))
    ).map((row) => row.id);
    if (userIds.length > 0) {
      const orgIds = (
        await db
          .select({ id: schema.member.organizationId })
          .from(schema.member)
          .where(inArray(schema.member.userId, userIds))
      ).map((row) => row.id);
      if (orgIds.length > 0) {
        await db
          .delete(schema.productImport)
          .where(inArray(schema.productImport.merchantId, orgIds));
        await db
          .delete(schema.productVariant)
          .where(inArray(schema.productVariant.merchantId, orgIds));
        await db.delete(schema.product).where(inArray(schema.product.merchantId, orgIds));
        await db.delete(schema.facebookPage).where(inArray(schema.facebookPage.merchantId, orgIds));
        await db
          .delete(schema.merchantSettings)
          .where(inArray(schema.merchantSettings.merchantId, orgIds));
      }
      await db.delete(schema.user).where(inArray(schema.user.id, userIds));
      if (orgIds.length > 0) {
        await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds));
      }
    }
    await pool.end();
  });

  it('answers 401 without a session', async () => {
    await request(server()).get('/api/v1/imports').expect(401);
    await request(server()).post('/api/v1/imports').send(range).expect(401);
  });

  describe('POST /imports', () => {
    it('queues a run and its job, and refuses a second while it goes', async () => {
      const { agent, merchantId } = await connected();

      const created = await agent.post('/api/v1/imports').send(range).expect(202);
      const run = importRunSchema.parse(created.body);
      expect(run).toMatchObject({
        status: 'queued',
        since: range.since,
        until: today,
        postsTotal: null,
      });
      expect(importsQueue.added).toEqual([
        { name: IMPORT_RUN_JOB, data: { merchantId, importId: run.id } },
      ]);

      const again = await agent.post('/api/v1/imports').send(range).expect(409);
      expect(again.body.error.code).toBe('IMPORT_ALREADY_RUNNING');
    });

    it('refuses dates out of order, a range over 366 days, and an end after today', async () => {
      const { agent } = await connected();
      const fieldsOf = async (body: object) => {
        const response = await agent
          .post('/api/v1/imports')
          .send({ ...range, ...body })
          .expect(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        return response.body.error.fields;
      };
      expect(await fieldsOf({ since: '2026-09-02', until: '2026-09-01' })).toMatchObject({
        since: [{ code: 'INVALID_VALUE' }],
      });
      expect(await fieldsOf({ since: '2025-01-01', until: '2026-01-02' })).toMatchObject({
        since: [{ code: 'MAX_VALUE', params: { max: 366 } }],
      });
      expect(await fieldsOf({ since: today, until: dayAfter(today) })).toMatchObject({
        until: [{ code: 'MAX_VALUE' }],
      });
      expect(await fieldsOf({ since: '2026-02-30' })).toMatchObject({
        since: [{ code: 'INVALID_FORMAT' }],
      });
    });

    it('needs a connected Page that lets us read its posts', async () => {
      const { agent } = await verifiedSellerWithShop();
      const unconnected = await agent.post('/api/v1/imports').send(range).expect(409);
      expect(unconnected.body.error.code).toBe('MESSENGER_PAGE_NOT_CONNECTED');

      const { agent: other } = await connected();
      graph.refuse = new GraphError(403, 200, 'Missing pages_read_engagement');
      const refused = await other.post('/api/v1/imports').send(range).expect(409);
      expect(refused.body.error.code).toBe('FACEBOOK_PERMISSION_MISSING');

      graph.refuse = new GraphError(500, 2, 'Service unavailable');
      const down = await other.post('/api/v1/imports').send(range).expect(503);
      expect(down.body.error.code).toBe('FACEBOOK_UNAVAILABLE');
    });

    it('answers IMPORT_NOT_AVAILABLE without an LLM', async () => {
      const { agent } = await connected();
      env.LLM_API_KEY = undefined;
      const response = await agent.post('/api/v1/imports').send(range).expect(503);
      expect(response.body.error.code).toBe('IMPORT_NOT_AVAILABLE');
    });
  });

  it('GET /imports/facebook/access says whether a run could read the posts', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    await expect(
      agent
        .get('/api/v1/imports/facebook/access')
        .expect(200)
        .then((r) => r.body),
    ).resolves.toEqual({ pageConnected: false, canReadPosts: false });

    await seedFacebookPage(db, merchantId, { accessToken: crypto.encrypt('page-token') });
    expect((await agent.get('/api/v1/imports/facebook/access').expect(200)).body).toEqual({
      pageConnected: true,
      canReadPosts: true,
    });
    graph.refuse = new GraphError(403, 10, 'no permission');
    expect((await agent.get('/api/v1/imports/facebook/access').expect(200)).body).toEqual({
      pageConnected: true,
      canReadPosts: false,
    });
  });

  it("lists a shop's own runs newest first, and never another shop's", async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const { agent: other } = await verifiedSellerWithShop();
    const older = await seedRun(merchantId);
    const newer = await seedRun(merchantId);

    const list = importRunListResponseSchema.parse(
      (await agent.get('/api/v1/imports').expect(200)).body,
    );
    expect(list.data.map((run) => run.id)).toEqual([newer.id, older.id]);
    expect(list.total).toBe(2);

    const hidden = await other.get(`/api/v1/imports/${older.id}`).expect(404);
    expect(hidden.body.error.code).toBe('IMPORT_NOT_FOUND');
    expect((await other.get(`/api/v1/imports/${older.id}/posts`).expect(404)).body.error.code).toBe(
      'IMPORT_NOT_FOUND',
    );
    expect((await other.get('/api/v1/imports').expect(200)).body.total).toBe(0);
  });

  it('stops a running run, and resumes it once stopped', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const run = await seedRun(merchantId, 'running');

    expect((await agent.post(`/api/v1/imports/${run.id}/resume`).expect(409)).body.error.code).toBe(
      'IMPORT_NOT_STOPPED',
    );
    const stopping = await agent.post(`/api/v1/imports/${run.id}/stop`).expect(200);
    expect(stopping.body.status).toBe('stopping');
    expect((await agent.post(`/api/v1/imports/${run.id}/stop`).expect(409)).body.error.code).toBe(
      'IMPORT_NOT_RUNNING',
    );

    await db
      .update(schema.productImport)
      .set({ status: 'stopped' })
      .where(eq(schema.productImport.id, run.id));
    const resumed = await agent.post(`/api/v1/imports/${run.id}/resume`).expect(202);
    expect(resumed.body.status).toBe('queued');
    expect(importsQueue.added).toEqual([
      { name: IMPORT_RUN_JOB, data: { merchantId, importId: run.id } },
    ]);

    // A second run can't be resumed past the one that is going.
    const other = await seedRun(merchantId, 'stopped');
    expect(
      (await agent.post(`/api/v1/imports/${other.id}/resume`).expect(409)).body.error.code,
    ).toBe('IMPORT_ALREADY_RUNNING');
  });

  it('lists the summary tabs and queues Import anyway for a skipped post only', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const run = await seedRun(merchantId);
    const priced = await seedProduct(db, merchantId, { name: 'Priced', status: 'draft' });
    await seedVariant(db, merchantId, priced.id, { name: null, isDefault: true, stock: null });
    const known = await seedProduct(db, merchantId, { name: 'Known', status: 'active' });
    const made = await seedPost(merchantId, run.id, { result: 'draft', productIds: [priced.id] });
    const skipped = await seedPost(merchantId, run.id, {
      result: 'in_catalog',
      matchedProductIds: [known.id],
    });

    const ready = importPostListResponseSchema.parse(
      (await agent.get(`/api/v1/imports/${run.id}/posts?result=ready`).expect(200)).body,
    );
    expect(ready.data).toEqual([
      expect.objectContaining({
        id: made.id,
        products: [expect.objectContaining({ id: priced.id, needsPrice: false, needsStock: true })],
      }),
    ]);
    const skippedTab = importPostListResponseSchema.parse(
      (await agent.get(`/api/v1/imports/${run.id}/posts?result=skipped`).expect(200)).body,
    );
    expect(skippedTab.data).toEqual([
      expect.objectContaining({
        id: skipped.id,
        matchedProducts: [{ id: known.id, name: 'Known' }],
      }),
    ]);
    await agent.get(`/api/v1/imports/${run.id}/posts?result=everything`).expect(400);

    const notSkipped = await agent
      .post(`/api/v1/imports/${run.id}/posts/${made.id}/import`)
      .expect(409);
    expect(notSkipped.body.error.code).toBe('IMPORT_POST_NOT_SKIPPED');
    const missing = await agent
      .post(`/api/v1/imports/${run.id}/posts/${randomUUID()}/import`)
      .expect(404);
    expect(missing.body.error.code).toBe('IMPORT_POST_NOT_FOUND');

    await agent.post(`/api/v1/imports/${run.id}/posts/${skipped.id}/import`).expect(202);
    expect(importsQueue.added).toEqual([
      { name: IMPORT_POST_JOB, data: { merchantId, importId: run.id, postId: skipped.id } },
    ]);
  });

  it("activates the run's priced drafts with a starting stock, and reports the rest", async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const run = await seedRun(merchantId);
    const draft = async (
      name: string,
      price: number | null,
      status: 'draft' | 'active' = 'draft',
    ) => {
      const product = await seedProduct(db, merchantId, { name, status });
      await seedVariant(db, merchantId, product.id, {
        name: null,
        isDefault: true,
        price,
        stock: null,
      });
      return product;
    };
    const priced = await draft('Priced', 99_000);
    const unpriced = await draft('Unpriced', null);
    const alreadyActive = await draft('Active', 99_000, 'active');
    const notThisRun = await draft('Elsewhere', 99_000);
    await seedPost(merchantId, run.id, {
      result: 'draft',
      productIds: [priced.id, unpriced.id, alreadyActive.id],
    });

    const response = await agent
      .post(`/api/v1/imports/${run.id}/activate`)
      .send({
        productIds: [priced.id, unpriced.id, alreadyActive.id, notThisRun.id],
        startingStock: 5,
      })
      .expect(200);

    expect(response.body).toEqual({
      activated: [priced.id],
      failed: [
        { productId: unpriced.id, code: 'PRODUCT_PRICE_MISSING' },
        { productId: alreadyActive.id, code: 'PRODUCT_NOT_DRAFT' },
        { productId: notThisRun.id, code: 'PRODUCT_NOT_FOUND' },
      ],
    });
    const product = await agent.get(`/api/v1/products/${priced.id}`).expect(200);
    expect(product.body).toMatchObject({
      status: 'active',
      variants: [{ price: 99_000, stock: 5 }],
    });

    const fromImport = await agent
      .get(`/api/v1/products?filter=all&importId=${run.id}`)
      .expect(200);
    expect(fromImport.body.data.map((row: { id: string }) => row.id).sort()).toEqual(
      [priced.id, unpriced.id, alreadyActive.id].sort(),
    );
  });
});
