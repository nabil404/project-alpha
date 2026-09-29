import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { deviceSessionSchema } from '@app/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import sharp from 'sharp';
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
import {
  InMemoryObjectStorage,
  TEST_PUBLIC_BASE_URL,
} from '../../storage/__tests__/in-memory-object-storage';
import { AccountModule } from '../account.module';

// Needs a real Postgres: sessions, password hashing and the hooks are Better
// Auth server behaviour. CI sets DATABASE_ADMIN_URL; locally, export it.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

describeDb('Settings > Account over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();
  const storage = new InMemoryObjectStorage();
  const jpeg = (side: number) =>
    sharp({ create: { width: side, height: side, channels: 3, background: '#48c' } })
      .jpeg()
      .toBuffer();

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
      imports: [TestInfrastructureModule, AuthModule, AccountModule],
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

  describe('/account/avatar', () => {
    it('uploads, replaces and removes the photo', async () => {
      const agent = await verifiedSeller(email('avatar'));

      const first = await agent
        .put('/api/v1/account/avatar')
        .attach('file', await jpeg(300), { filename: 'me.jpg', contentType: 'image/jpeg' })
        .expect(200);
      expect(first.body.image).toMatch(new RegExp(`^${TEST_PUBLIC_BASE_URL}/u/[^/]+/avatar/`));
      const session = await agent.get('/api/v1/auth/get-session').expect(200);
      expect(session.body.user.image).toBe(first.body.image);

      const second = await agent
        .put('/api/v1/account/avatar')
        .attach('file', await jpeg(300), 'me2.jpg')
        .expect(200);
      expect(second.body.image).not.toBe(first.body.image);
      const keys = () => [...storage.objects.keys()].filter((key) => key.startsWith('u/'));
      expect(keys()).toHaveLength(1);

      const removed = await agent.delete('/api/v1/account/avatar').expect(200);
      expect(removed.body).toEqual({ image: null });
      expect(keys()).toHaveLength(0);
    });

    it('refuses a photo below the minimum size', async () => {
      const agent = await verifiedSeller(email('tiny'));

      const response = await agent
        .put('/api/v1/account/avatar')
        .attach('file', await jpeg(100), 'tiny.jpg')
        .expect(400);

      expect(response.body.error).toMatchObject({
        code: 'AVATAR_TOO_SMALL',
        params: { minSide: 256 },
      });
    });

    it('asks for a file when none is attached', async () => {
      const agent = await verifiedSeller(email('nofile'));

      const response = await agent.put('/api/v1/account/avatar').expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('turns away a request with no session', async () => {
      await request(server()).delete('/api/v1/account/avatar').expect(401);
    });
  });

  describe('/account/sessions', () => {
    it('lists devices, current first, without tokens or addresses', async () => {
      const address = email('devices');
      const here = await verifiedSeller(address);
      await signIn(address, IPHONE_SAFARI);

      const response = await here.get('/api/v1/account/sessions').expect(200);

      expect(response.body).toHaveLength(2);
      const [current, phone] = response.body.map((s: unknown) => deviceSessionSchema.parse(s));
      expect(current?.current).toBe(true);
      expect(phone).toMatchObject({ current: false, browser: 'Safari', os: 'iOS' });
      for (const entry of response.body) {
        expect(entry).not.toHaveProperty('token');
        expect(entry).not.toHaveProperty('ipAddress');
      }
    });

    it('signs another device out', async () => {
      const address = email('revoke');
      const here = await verifiedSeller(address);
      const phone = await signIn(address, IPHONE_SAFARI);
      const list = await here.get('/api/v1/account/sessions').expect(200);
      const phoneId = list.body.find((s: { current: boolean }) => !s.current).id;

      await here.delete(`/api/v1/account/sessions/${phoneId}`).set('Origin', APP_URL).expect(204);

      await phone.get('/api/v1/account/sessions').expect(401);
      // Review Focus 4: a second click on the same row.
      const again = await here
        .delete(`/api/v1/account/sessions/${phoneId}`)
        .set('Origin', APP_URL)
        .expect(404);
      expect(again.body.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('refuses to end the session making the request', async () => {
      const here = await verifiedSeller(email('self'));
      const list = await here.get('/api/v1/account/sessions').expect(200);

      const response = await here
        .delete(`/api/v1/account/sessions/${list.body[0].id}`)
        .set('Origin', APP_URL)
        .expect(409);

      expect(response.body.error.code).toBe('SESSION_IS_CURRENT');
    });

    it("answers 404 for another seller's session", async () => {
      const mine = await verifiedSeller(email('mine'));
      const theirs = await verifiedSeller(email('theirs'));
      const theirList = await theirs.get('/api/v1/account/sessions').expect(200);

      await mine
        .delete(`/api/v1/account/sessions/${theirList.body[0].id}`)
        .set('Origin', APP_URL)
        .expect(404);
      await theirs.get('/api/v1/account/sessions').expect(200);
    });
  });
});
