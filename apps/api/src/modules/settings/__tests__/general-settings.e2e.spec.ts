import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { generalSettingsSchema, LOGO_MAX_BYTES } from '@app/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { AccountModule } from '../../account/account.module';
import { CapturingMailer } from '../../auth/__tests__/capturing-mailer';
import { AuthModule } from '../../auth/auth.module';
import { SessionGuard } from '../../auth/session.guard';
import { AppConfig } from '../../config/app.config';
import { DATABASE, type Database } from '../../database/database.module';
import { seedCustomer } from '../../database/__tests__/conversation-seeds';
import { seedOrder } from '../../database/__tests__/order-seeds';
import * as schema from '../../database/schema/index';
import { MailService } from '../../mail/mail.service';
import { ObjectStorage } from '../../storage/object-storage';
import {
  InMemoryObjectStorage,
  TEST_PUBLIC_BASE_URL,
} from '../../storage/__tests__/in-memory-object-storage';
import { SettingsModule } from '../settings.module';

// Needs a real Postgres: sessions come from Better Auth. CI sets
// DATABASE_ADMIN_URL; locally, export it.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > General over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();
  const storage = new InMemoryObjectStorage();
  const jpeg = (side: number) =>
    sharp({ create: { width: side, height: side, channels: 3, background: '#48c' } })
      .jpeg()
      .toBuffer();

  const server = () => app.getHttpServer();

  /** Signs up and follows the verification link, leaving the agent signed in. */
  const verifiedSeller = async (shopName = "Nadia's Kitchen") => {
    const address = `seller-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName,
        phone: '01712-345678',
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    return { agent, address };
  };

  const merchantOf = async (address: string) => {
    const [row] = await db
      .select({ merchantId: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.user.email, address));
    if (!row) throw new Error('no merchant');
    return row.merchantId;
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

  describe('/settings/general', () => {
    it('reads a new shop as its sign-up name and the default region', async () => {
      const { agent } = await verifiedSeller("Rahim's Kitchen");

      const response = await agent.get('/api/v1/settings/general').expect(200);

      expect(generalSettingsSchema.parse(response.body)).toEqual({
        name: "Rahim's Kitchen",
        logo: null,
        contactPhone: null,
        pickupAddress: null,
        country: 'BD',
        currency: 'BDT',
        timeZone: 'Asia/Dhaka',
        dateFormat: 'd MMM yyyy',
        currencyLocked: false,
      });
    });

    it('saves the profile and region, normalizing the phone', async () => {
      const { agent } = await verifiedSeller();

      const response = await agent
        .patch('/api/v1/settings/general')
        .send({
          name: '  Lagos Threads ',
          contactPhone: '+234 802 123 4567',
          pickupAddress: '12 Allen Avenue, Ikeja',
          country: 'NG',
          currency: 'NGN',
          timeZone: 'Africa/Lagos',
          dateFormat: 'dd/MM/yyyy',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Lagos Threads',
        contactPhone: '+2348021234567',
        country: 'NG',
        currency: 'NGN',
        timeZone: 'Africa/Lagos',
        dateFormat: 'dd/MM/yyyy',
      });
      await expect(agent.get('/api/v1/settings/general')).resolves.toMatchObject({
        body: response.body,
      });
    });

    it('names each invalid field', async () => {
      const { agent } = await verifiedSeller();

      const response = await agent
        .patch('/api/v1/settings/general')
        .send({ contactPhone: '+880 12', timeZone: 'Asia/Calcutta', currency: 'XYZ', name: ' ' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.fields).toMatchObject({
        contactPhone: [{ code: 'INVALID_PHONE' }],
        timeZone: [{ code: 'INVALID_INPUT' }],
        currency: [{ code: 'INVALID_INPUT' }],
        name: [{ code: 'REQUIRED' }],
      });
    });

    it('refuses a currency change once the shop has an order', async () => {
      const { agent, address } = await verifiedSeller();
      const merchantId = await merchantOf(address);
      const customer = await seedCustomer(db, merchantId);
      await seedOrder(db, merchantId, customer.id);

      const response = await agent
        .patch('/api/v1/settings/general')
        .send({ currency: 'USD' })
        .expect(409);

      expect(response.body.error).toMatchObject({
        code: 'CURRENCY_LOCKED',
        params: { currency: 'BDT' },
      });
      await expect(agent.get('/api/v1/settings/general')).resolves.toMatchObject({
        body: { currency: 'BDT', currencyLocked: true },
      });
    });

    it('needs a session', async () => {
      await request(server()).get('/api/v1/settings/general').expect(401);
      await request(server()).patch('/api/v1/settings/general').send({}).expect(401);
    });
  });

  describe('/settings/general/logo', () => {
    const logoKeys = () => [...storage.objects.keys()].filter((key) => key.startsWith('o/'));

    it('stores the logo as a JPEG under the shop, replacing the previous one', async () => {
      const { agent, address } = await verifiedSeller();
      const merchantId = await merchantOf(address);

      const first = await agent
        .put('/api/v1/settings/general/logo')
        .attach('file', await jpeg(300), { filename: 'logo.jpg', contentType: 'image/jpeg' })
        .expect(200);
      expect(first.body.logo).toMatch(
        new RegExp(`^${TEST_PUBLIC_BASE_URL}/o/${merchantId}/logo/[0-9a-f-]{36}\\.jpg$`),
      );

      const second = await agent
        .put('/api/v1/settings/general/logo')
        .attach('file', await jpeg(300), 'logo2.jpg')
        .expect(200);
      const ours = logoKeys().filter((key) => key.startsWith(`o/${merchantId}/`));
      expect(ours).toEqual([second.body.logo.slice(TEST_PUBLIC_BASE_URL.length + 1)]);
      await expect(agent.get('/api/v1/settings/general')).resolves.toMatchObject({
        body: { logo: second.body.logo },
      });

      await agent.delete('/api/v1/settings/general/logo').expect(200, { logo: null });
      expect(logoKeys().filter((key) => key.startsWith(`o/${merchantId}/`))).toEqual([]);
    });

    it('refuses an image that is too small, too large or not an image', async () => {
      const { agent } = await verifiedSeller();

      const small = await agent
        .put('/api/v1/settings/general/logo')
        .attach('file', await jpeg(100), 'tiny.jpg')
        .expect(400);
      expect(small.body.error).toMatchObject({ code: 'LOGO_TOO_SMALL', params: { minSide: 256 } });

      const large = await agent
        .put('/api/v1/settings/general/logo')
        .attach('file', Buffer.alloc(LOGO_MAX_BYTES + 1), 'huge.jpg')
        .expect(413);
      expect(large.body.error.code).toBe('LOGO_TOO_LARGE');

      const text = await agent
        .put('/api/v1/settings/general/logo')
        .attach('file', Buffer.from('not an image'), 'logo.jpg')
        .expect(400);
      expect(text.body.error.code).toBe('LOGO_INVALID');

      await agent.put('/api/v1/settings/general/logo').expect(400);
    });
  });

  describe('/account/preferences', () => {
    it("stores the person's language, which the session then carries", async () => {
      const { agent } = await verifiedSeller();

      await agent.patch('/api/v1/account/preferences').send({ locale: 'en' }).expect(200, {
        locale: 'en',
      });
      const session = await agent.get('/api/v1/auth/get-session').expect(200);
      expect(session.body.user.locale).toBe('en');

      await agent.patch('/api/v1/account/preferences').send({ locale: null }).expect(200, {
        locale: null,
      });
    });

    it('refuses a language the dashboard has no translation for', async () => {
      const { agent } = await verifiedSeller();

      const response = await agent
        .patch('/api/v1/account/preferences')
        .send({ locale: 'xx' })
        .expect(400);
      expect(response.body.error.fields.locale[0].code).toBe('INVALID_VALUE');
    });

    it('cannot be set through Better Auth directly', async () => {
      const { agent } = await verifiedSeller();

      const response = await agent
        .post('/api/v1/auth/update-user')
        .set('Origin', APP_URL)
        .send({ name: 'Nadia Rahman', locale: 'en' })
        .expect(400);
      expect(response.body.error.fields.locale[0].code).toBe('UNRECOGNIZED_KEYS');
    });
  });
});
