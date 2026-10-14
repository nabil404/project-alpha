import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { adProductListResponseSchema } from '@app/shared';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../../bootstrap';
import { listenOnLoopback } from '../../../../__tests__/listen-on-loopback';
import { describeDb, testDatabaseUrl } from '../../../../__tests__/test-env';
import { CapturingMailer } from '../../../auth/__tests__/capturing-mailer';
import { AuthModule } from '../../../auth/auth.module';
import { SessionGuard } from '../../../auth/session.guard';
import { AppConfig } from '../../../config/app.config';
import { seedProduct } from '../../../database/__tests__/catalog-test-db';
import { randomPageId } from '../../../database/__tests__/conversation-seeds';
import { DATABASE, type Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import { MailService } from '../../../mail/mail.service';
import { AdProductsModule } from '../ad-products.module';

// Needs a real Postgres: sessions come from Better Auth.
const url = testDatabaseUrl;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const ROUTE = '/api/v1/messenger/ads';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Messenger ads over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();

  const server = () => app.getHttpServer();

  /** Signs up, follows the verification link, and reads the shop id. */
  const verifiedSellerWithShop = async () => {
    const address = `seller-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName: "Nadia's Kitchen",
        phone: '+880 1712-345678',
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    const session = await agent.get('/api/v1/auth/get-session').expect(200);
    return { agent, merchantId: session.body.session.activeOrganizationId as string };
  };

  const seedAd = async (
    merchantId: string,
    overrides: Partial<typeof schema.adProduct.$inferInsert> & { adId: string },
  ) => {
    const [row] = await db
      .insert(schema.adProduct)
      .values({ merchantId, pageId: randomPageId(), ...overrides })
      .returning();
    if (!row) throw new Error('seedAd returned no row');
    return row;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });

    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    };

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
      imports: [TestInfrastructureModule, AuthModule, AdProductsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
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
        await db.delete(schema.adProduct).where(inArray(schema.adProduct.merchantId, orgIds));
        await db.delete(schema.product).where(inArray(schema.product.merchantId, orgIds));
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
    await request(server()).get(ROUTE).expect(401);
  });

  it('lists the shop’s ads newest first and maps one to a product', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const product = await seedProduct(db, merchantId, { name: 'Blue kurti', status: 'active' });
    const older = await seedAd(merchantId, { adId: 'ad-old', lastSeenAt: new Date('2026-10-01') });
    await seedAd(merchantId, { adId: 'ad-new', lastSeenAt: new Date('2026-10-12') });

    const list = await agent.get(ROUTE).expect(200);
    expect(adProductListResponseSchema.parse(list.body).data.map((ad) => ad.adId)).toEqual([
      'ad-new',
      'ad-old',
    ]);

    const { body } = await agent
      .patch(`${ROUTE}/${older.id}`)
      .set('Origin', APP_URL)
      .send({ productId: product.id })
      .expect(200);
    expect(body).toMatchObject({
      adId: 'ad-old',
      product: { id: product.id, name: 'Blue kurti', status: 'active' },
    });
  });

  it('refuses an archived product', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const archived = await seedProduct(db, merchantId, { name: 'Old', status: 'archived' });
    const ad = await seedAd(merchantId, { adId: `ad-${randomUUID()}` });
    const { body } = await agent
      .patch(`${ROUTE}/${ad.id}`)
      .set('Origin', APP_URL)
      .send({ productId: archived.id })
      .expect(409);
    expect(body.error.code).toBe('AD_PRODUCT_ARCHIVED');
  });

  it("refuses another shop's product and another shop's ad", async () => {
    const a = await verifiedSellerWithShop();
    const b = await verifiedSellerWithShop();
    const theirProduct = await seedProduct(db, b.merchantId, { name: 'Theirs' });
    const mine = await seedAd(a.merchantId, { adId: `ad-${randomUUID()}` });
    const theirAd = await seedAd(b.merchantId, { adId: `ad-${randomUUID()}` });

    expect(
      (
        await a.agent
          .patch(`${ROUTE}/${mine.id}`)
          .set('Origin', APP_URL)
          .send({ productId: theirProduct.id })
          .expect(404)
      ).body.error.code,
    ).toBe('PRODUCT_NOT_FOUND');
    expect(
      (
        await a.agent
          .patch(`${ROUTE}/${theirAd.id}`)
          .set('Origin', APP_URL)
          .send({ productId: null })
          .expect(404)
      ).body.error.code,
    ).toBe('AD_PRODUCT_NOT_FOUND');
  });

  it('unmaps with null', async () => {
    const { agent, merchantId } = await verifiedSellerWithShop();
    const product = await seedProduct(db, merchantId, { name: 'Kurti' });
    const ad = await seedAd(merchantId, { adId: `ad-${randomUUID()}`, productId: product.id });
    const { body } = await agent
      .patch(`${ROUTE}/${ad.id}`)
      .set('Origin', APP_URL)
      .send({ productId: null })
      .expect(200);
    expect(body.product).toBeNull();
  });

  it('answers a malformed id with a coded 400', async () => {
    const { agent } = await verifiedSellerWithShop();
    const { body } = await agent
      .patch(`${ROUTE}/not-a-uuid`)
      .set('Origin', APP_URL)
      .send({ productId: null })
      .expect(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
