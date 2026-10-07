import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NOTIFICATION_DEFAULTS, notificationSettingsSchema } from '@app/shared';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
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
const ROUTE = '/api/v1/settings/notifications';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Notifications over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();

  const server = () => app.getHttpServer();

  /** Signs up and follows the verification link, leaving the agent signed in. */
  const verifiedSeller = async () => {
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
    return agent;
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
      imports: [TestInfrastructureModule, AuthModule, SettingsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideProvider(MailService)
      .useValue(mailer)
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
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
        await db
          .delete(schema.merchantSettings)
          .where(inArray(schema.merchantSettings.merchantId, orgIds));
      }
      // member, session, account and notification_preference cascade from
      // user; organization does not.
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

  it('reads as the defaults before the first toggle', async () => {
    const agent = await verifiedSeller();

    const response = await agent.get(ROUTE).expect(200);

    expect(notificationSettingsSchema.parse(response.body)).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('changes only the switches sent, and keeps them', async () => {
    const agent = await verifiedSeller();

    const first = await agent.patch(ROUTE).send({ dailySummary: true }).expect(200);
    expect(first.body).toEqual({ newOrder: true, customerWaiting: true, dailySummary: true });

    const second = await agent.patch(ROUTE).send({ newOrder: false }).expect(200);
    expect(second.body).toEqual({ newOrder: false, customerWaiting: true, dailySummary: true });

    const read = await agent.get(ROUTE).expect(200);
    expect(read.body).toEqual(second.body);
  });

  it("leaves another seller's switches alone", async () => {
    const mine = await verifiedSeller();
    const theirs = await verifiedSeller();

    await mine.patch(ROUTE).send({ customerWaiting: false }).expect(200);

    const response = await theirs.get(ROUTE).expect(200);
    expect(response.body).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('treats an empty body as no change', async () => {
    const agent = await verifiedSeller();

    const response = await agent.patch(ROUTE).send({}).expect(200);

    expect(response.body).toEqual(NOTIFICATION_DEFAULTS);
  });

  it.each([
    ['an unknown switch', { pushNewOrder: true }],
    ['a value that is not a boolean', { newOrder: 'yes' }],
  ])('refuses %s with VALIDATION_FAILED', async (_, body) => {
    const agent = await verifiedSeller();

    const response = await agent.patch(ROUTE).send(body).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
