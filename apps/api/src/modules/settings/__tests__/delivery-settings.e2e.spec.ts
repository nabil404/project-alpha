import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { deliverySettingsSchema } from '@app/shared';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { AccountModule } from '../../account/account.module';
import { CapturingMailer } from '../../auth/__tests__/capturing-mailer';
import { AuthModule } from '../../auth/auth.module';
import { SessionGuard } from '../../auth/session.guard';
import { AppConfig } from '../../config/app.config';
import { DATABASE, type Database } from '../../database/database.module';
import * as schema from '../../database/schema/index';
import { MailService } from '../../mail/mail.service';
import { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { SettingsModule } from '../settings.module';

// Needs a real Postgres: sessions come from Better Auth. CI sets
// DATABASE_ADMIN_URL; locally, export it.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Delivery charges over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();
  const storage = new InMemoryObjectStorage();
  const server = () => app.getHttpServer();

  /** Signs up and follows the verification link, leaving the agent signed in. */
  const verifiedSeller = async (shopName = "Nadia's Kitchen", phone = '+880 1712-345678') => {
    const address = `seller-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName,
        phone,
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    return { agent, address };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });

    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
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
      imports: [TestInfrastructureModule, AuthModule, AccountModule, SettingsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideProvider(MailService)
      .useValue(mailer)
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await app.init();
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
        await db.delete(schema.orderItem).where(inArray(schema.orderItem.merchantId, orgIds));
        await db.delete(schema.order).where(inArray(schema.order.merchantId, orgIds));
        await db.delete(schema.customer).where(inArray(schema.customer.merchantId, orgIds));
        await db
          .delete(schema.deliveryCharge)
          .where(inArray(schema.deliveryCharge.merchantId, orgIds));
        await db
          .delete(schema.merchantSettings)
          .where(inArray(schema.merchantSettings.merchantId, orgIds));
      }
      // member, session and account cascade from user; organization does not.
      await db.delete(schema.user).where(inArray(schema.user.id, userIds));
      if (orgIds.length > 0) {
        await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds));
      }
    }
    await pool.end();
  });

  const everywhereElse = { charge: 12000, deliveryTime: '3–5 days' };

  it('saves the page and reads it back, names trimmed', async () => {
    const { agent } = await verifiedSeller();

    const saved = await agent
      .put('/api/v1/settings/delivery')
      .set('Origin', APP_URL)
      .send({
        deliveryCharges: [{ areaName: ' Dhaka ', charge: 6000, deliveryTime: '1–2 days' }],
        everywhereElse,
        freeDeliveryOver: 300000,
      })
      .expect(200);

    expect(deliverySettingsSchema.parse(saved.body)).toMatchObject({
      currency: 'BDT',
      deliveryCharges: [{ areaName: 'Dhaka', charge: 6000, deliveryTime: '1–2 days' }],
      everywhereElse,
      freeDeliveryOver: 300000,
    });
    const read = await agent.get('/api/v1/settings/delivery').expect(200);
    expect(read.body).toEqual(saved.body);
  });

  it('answers a duplicate name with a field error on the second row', async () => {
    const { agent } = await verifiedSeller();

    const response = await agent
      .put('/api/v1/settings/delivery')
      .set('Origin', APP_URL)
      .send({
        deliveryCharges: [
          { areaName: 'Dhaka', charge: 6000 },
          { areaName: 'dhaka ', charge: 7000 },
        ],
        everywhereElse,
        freeDeliveryOver: null,
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.fields).toMatchObject({
      'deliveryCharges.1.areaName': [{ code: 'DUPLICATE' }],
    });
  });

  it('refuses an unknown id and an unknown property', async () => {
    const { agent } = await verifiedSeller();

    const unknown = await agent
      .put('/api/v1/settings/delivery')
      .set('Origin', APP_URL)
      .send({
        deliveryCharges: [{ id: randomUUID(), areaName: 'Dhaka', charge: 6000 }],
        everywhereElse,
        freeDeliveryOver: null,
      })
      .expect(404);
    expect(unknown.body.error.code).toBe('DELIVERY_CHARGE_NOT_FOUND');

    await agent
      .put('/api/v1/settings/delivery')
      .set('Origin', APP_URL)
      .send({ deliveryCharges: [], everywhereElse, freeDeliveryOver: null, extra: true })
      .expect(400);
  });

  it('refuses a signed-out request', async () => {
    await request(server()).get('/api/v1/settings/delivery').expect(401);
  });
});
