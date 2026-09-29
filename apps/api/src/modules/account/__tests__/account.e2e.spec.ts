import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { eq, inArray, like } from 'drizzle-orm';
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

// Needs a real Postgres: sessions, password hashing and the hooks are Better
// Auth server behaviour. CI sets DATABASE_ADMIN_URL; locally, export it.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Account over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();

  const email = (label: string) => `${label}-${randomUUID()}@${EMAIL_DOMAIN}`;
  const server = () => app.getHttpServer();

  /** Better Auth rejects cross-site POSTs; the SPA is same-origin with APP_URL. */
  const post = (agent: request.Agent | ReturnType<typeof request>, path: string, body: object) =>
    agent.post(path).set('Origin', APP_URL).send(body);

  /** Signs up and follows the verification link, leaving the agent signed in. */
  const verifiedSeller = async (address: string) => {
    await post(request(server()), '/api/v1/auth/sign-up/email', {
      email: address,
      password: PASSWORD,
      name: 'Nadia Rahman',
      shopName: "Nadia's Kitchen",
      phone: '01712-345678',
      callbackURL: '/',
    }).expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    return agent;
  };

  /** A second device: a fresh agent signed in with the password. */
  const signIn = async (address: string, userAgent?: string) => {
    const agent = request.agent(server());
    const req = agent.post('/api/v1/auth/sign-in/email').set('Origin', APP_URL);
    if (userAgent) req.set('User-Agent', userAgent);
    await req.send({ email: address, password: PASSWORD }).expect(200);
    return agent;
  };

  const nameOf = async (address: string) =>
    (
      await db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.email, address))
    )[0]?.name;

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
      imports: [TestInfrastructureModule, AuthModule],
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
      // member, session and account cascade from user; organization does not.
      await db.delete(schema.user).where(inArray(schema.user.id, userIds));
      if (orgIds.length > 0) {
        await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds));
      }
    }
    await pool.end();
  });

  describe('POST /auth/update-user', () => {
    it('stores the trimmed name', async () => {
      const address = email('rename');
      const agent = await verifiedSeller(address);

      await post(agent, '/api/v1/auth/update-user', { name: '  Rahim Uddin  ' }).expect(200);

      expect(await nameOf(address)).toBe('Rahim Uddin');
    });

    it('rejects a blank name against the `name` field', async () => {
      const agent = await verifiedSeller(email('blank'));

      const response = await post(agent, '/api/v1/auth/update-user', { name: '   ' }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.fields.name[0].code).toBe('REQUIRED');
    });

    it('refuses to set the photo, which only /account/avatar may do', async () => {
      const address = email('image');
      const agent = await verifiedSeller(address);

      const response = await post(agent, '/api/v1/auth/update-user', {
        name: 'Nadia Rahman',
        image: 'https://tracker.example.test/pixel.gif',
      }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.fields.image[0].code).toBe('UNRECOGNIZED_KEYS');
    });
  });

  describe('POST /auth/change-password', () => {
    it('answers a wrong current password with AUTH_WRONG_PASSWORD', async () => {
      const agent = await verifiedSeller(email('wrong'));

      const response = await post(agent, '/api/v1/auth/change-password', {
        currentPassword: 'not the password',
        newPassword: 'a brand new passphrase',
        revokeOtherSessions: false,
      }).expect(400);

      expect(response.body.error.code).toBe('AUTH_WRONG_PASSWORD');
    });

    it('signs other devices out but keeps this one signed in', async () => {
      const address = email('change');
      const here = await verifiedSeller(address);
      const elsewhere = await signIn(address);

      await post(here, '/api/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: 'a brand new passphrase',
        revokeOtherSessions: true,
      }).expect(200);

      const elsewhereSession = await elsewhere.get('/api/v1/auth/get-session').expect(200);
      expect(elsewhereSession.body).toBeNull();
      const hereSession = await here.get('/api/v1/auth/get-session').expect(200);
      expect(hereSession.body?.user.email).toBe(address);
    });
  });
});
