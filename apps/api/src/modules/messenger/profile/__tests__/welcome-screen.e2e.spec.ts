import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { welcomeScreenSchema } from '@app/shared';
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
import { seedFacebookPage } from '../../../database/__tests__/conversation-seeds';
import { DATABASE, type Database } from '../../../database/database.module';
import * as schema from '../../../database/schema/index';
import { MailService } from '../../../mail/mail.service';
import {
  FakeQueueModule,
  fakeMessengerProfileQueue,
} from '../../../queue/__tests__/fake-queue.module';
import { QueueModule } from '../../../queue/queue.module';
import { MessengerProfileModule } from '../messenger-profile.module';

// Needs a real Postgres: sessions come from Better Auth.
const url = testDatabaseUrl;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const ROUTE = '/api/v1/settings/messenger-welcome';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Messenger welcome screen over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();
  const queue = fakeMessengerProfileQueue;

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

  /** Gives the agent's shop a connected Page. */
  const connectPage = async (agent: ReturnType<typeof request.agent>) => {
    const session = await agent.get('/api/v1/auth/get-session').expect(200);
    await seedFacebookPage(db, session.body.session.activeOrganizationId);
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
      imports: [TestInfrastructureModule, AuthModule, MessengerProfileModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideModule(QueueModule)
      .useModule(FakeQueueModule)
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
    queue.added = [];
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
    await request(server()).get(ROUTE).expect(401);
  });

  it('reads the defaults for the shop’s language until the seller saves', async () => {
    const agent = await verifiedSeller();

    const { body } = await agent.get(ROUTE).expect(200);

    expect(welcomeScreenSchema.parse(body)).toMatchObject({
      isDefault: true,
      iceBreakers: [
        expect.objectContaining({ kind: 'browse' }),
        expect.anything(),
        expect.anything(),
      ],
      profileSync: { status: 'not_connected' },
    });
  });

  it('saves, and queues a sync when a Page is connected', async () => {
    const agent = await verifiedSeller();
    await connectPage(agent);
    const input = {
      greeting: 'Hello {first_name}',
      iceBreakers: [{ kind: 'ask', question: 'Do you ship to Sylhet?' }],
    };

    const { body } = await agent.put(ROUTE).set('Origin', APP_URL).send(input).expect(200);

    expect(body).toMatchObject({ ...input, isDefault: false, profileSync: { status: 'pending' } });
    expect(queue.added).toHaveLength(1);
    const read = await agent.get(ROUTE).expect(200);
    expect(read.body).toMatchObject(input);
  });

  it('saves without queuing when no Page is connected', async () => {
    const agent = await verifiedSeller();

    const { body } = await agent
      .put(ROUTE)
      .set('Origin', APP_URL)
      .send({ greeting: 'Hi', iceBreakers: [] })
      .expect(200);

    expect(body).toMatchObject({ greeting: 'Hi', profileSync: { status: 'not_connected' } });
    expect(queue.added).toEqual([]);
  });

  it("never shows or queues for another seller's Page", async () => {
    const mine = await verifiedSeller();
    const theirs = await verifiedSeller();
    await connectPage(theirs);

    await mine
      .put(ROUTE)
      .set('Origin', APP_URL)
      .send({ greeting: 'Hi', iceBreakers: [] })
      .expect(200);

    expect(queue.added).toEqual([]);
    const read = await theirs.get(ROUTE).expect(200);
    expect(read.body).toMatchObject({ isDefault: true, profileSync: { status: 'live' } });
  });

  it('refuses a fifth ice breaker with the coded envelope', async () => {
    const agent = await verifiedSeller();
    const five = Array.from({ length: 5 }, () => ({ kind: 'ask', question: 'Q?' }));

    const { body } = await agent
      .put(ROUTE)
      .set('Origin', APP_URL)
      .send({ greeting: 'Hi', iceBreakers: five })
      .expect(400);

    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
