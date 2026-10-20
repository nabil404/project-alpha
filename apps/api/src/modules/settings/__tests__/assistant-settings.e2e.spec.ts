import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ASSISTANT_SETTINGS_DEFAULTS, assistantSettingsViewSchema } from '@app/shared';
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
import { QueueModule } from '../../queue/queue.module';
import { FakeQueueModule } from '../../queue/__tests__/fake-queue.module';
import { MailService } from '../../mail/mail.service';
import { ObjectStorage } from '../../storage/object-storage';
import { InMemoryObjectStorage } from '../../storage/__tests__/in-memory-object-storage';
import { SettingsModule } from '../settings.module';
import { listenOnLoopback } from '../../../__tests__/listen-on-loopback';
import { describeDb, testDatabaseUrl } from '../../../__tests__/test-env';

// Needs a real Postgres: sessions come from Better Auth.
const url = testDatabaseUrl;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const ROUTE = '/api/v1/settings/assistant';
const LANGUAGES = ['en', 'bn', 'ur'];
const DEFAULTS = { ...ASSISTANT_SETTINGS_DEFAULTS, supportedLanguages: LANGUAGES };

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Order assistant over HTTP', () => {
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

    const env: Record<string, unknown> = {
      NODE_ENV: 'test',
      APP_URL,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ASSISTANT_LANGUAGES: LANGUAGES,
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
      // SettingsModule reaches the Messenger Profile queue; Redis is not needed here.
      .overrideModule(QueueModule)
      .useModule(FakeQueueModule)
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
        await db
          .delete(schema.assistantSettings)
          .where(inArray(schema.assistantSettings.merchantId, orgIds));
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

  it('answers 401 without a session', async () => {
    await request(server()).get(ROUTE).expect(401);
  });

  it('reads as the defaults before the first save', async () => {
    const agent = await verifiedSeller();

    const response = await agent.get(ROUTE).expect(200);

    expect(assistantSettingsViewSchema.parse(response.body)).toEqual(DEFAULTS);
  });

  it('changes only the fields sent, trims the notes, and keeps them', async () => {
    const agent = await verifiedSeller();

    const first = await agent
      .patch(ROUTE)
      .send({ tone: 'formal', notes: "  We don't deliver on Fridays.  " })
      .expect(200);
    expect(first.body).toEqual({
      ...DEFAULTS,
      tone: 'formal',
      notes: "We don't deliver on Fridays.",
    });

    const second = await agent.patch(ROUTE).send({ defaultLanguage: 'bn' }).expect(200);
    expect(second.body).toEqual({ ...first.body, defaultLanguage: 'bn' });

    const read = await agent.get(ROUTE).expect(200);
    expect(read.body).toEqual(second.body);
  });

  it("leaves another seller's settings alone", async () => {
    const mine = await verifiedSeller();
    const theirs = await verifiedSeller();

    await mine.patch(ROUTE).send({ tone: 'direct', notes: 'Cash on delivery only.' }).expect(200);

    const response = await theirs.get(ROUTE).expect(200);
    expect(response.body).toEqual(DEFAULTS);
  });

  it('treats an empty body as no change', async () => {
    const agent = await verifiedSeller();

    const response = await agent.patch(ROUTE).send({}).expect(200);

    expect(response.body).toEqual(DEFAULTS);
  });

  it.each([
    ['an unknown field', { greeting: 'Hi' }],
    ['an unknown tone', { tone: 'cheeky' }],
    ['a language that is not a code', { defaultLanguage: 'English' }],
    ['notes over 1000 characters', { notes: 'x'.repeat(1001) }],
  ])('refuses %s with VALIDATION_FAILED', async (_, body) => {
    const agent = await verifiedSeller();

    const response = await agent.patch(ROUTE).send(body).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a language ASSISTANT_LANGUAGES does not list, naming the ones it does', async () => {
    const agent = await verifiedSeller();

    const response = await agent.patch(ROUTE).send({ defaultLanguage: 'fr' }).expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: {
        defaultLanguage: [{ code: 'INVALID_VALUE', params: { values: 'match, en, bn, ur' } }],
      },
    });
    expect((await agent.get(ROUTE).expect(200)).body).toEqual(DEFAULTS);
  });
});
