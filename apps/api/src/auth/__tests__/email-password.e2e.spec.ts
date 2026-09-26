import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Global,
  Module,
  Post,
  Req,
  UseGuards,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { configureApp, NEST_APP_OPTIONS } from '../../bootstrap.js';
import { TenantGuard, type TenantRequest } from '../../common/tenant.guard.js';
import { AppConfig } from '../../config/app.config.js';
import { DATABASE, type Database } from '../../database/database.module.js';
import * as schema from '../../database/schema/index.js';
import { MailService, type Mailer } from '../../modules/mail/mail.service.js';
import type { MailMessage } from '../../modules/mail/templates.js';
import type { RawBodyRequest } from '../../modules/messenger/raw-body.js';
import { AuthModule } from '../auth.module.js';
import { SessionGuard } from '../session.guard.js';

// Needs a real Postgres: Better Auth, the organization bootstrap and the token
// tables are all server behaviour. CI sets DATABASE_ADMIN_URL; locally, export
// it (pointing at docker/compose.dev.yml) to run these.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/** Captures mail instead of sending it, so the spec can follow the links. */
class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  dispatch(message: MailMessage): void {
    this.sent.push(message);
  }

  /** The most recent message to `to`, failing loudly if there is none. */
  lastTo(to: string): MailMessage {
    const message = this.sent.filter((mail) => mail.to === to).at(-1);
    if (!message) {
      throw new Error(`No mail sent to ${to}`);
    }
    return message;
  }

  /** The link in the most recent message to `to`, as a path on this server. */
  linkTo(to: string): string {
    const link = /https?:\/\/\S+/.exec(this.lastTo(to).text)?.[0];
    if (!link) {
      throw new Error(`No link in the last mail to ${to}`);
    }
    const parsed = new URL(link);
    return `${parsed.pathname}${parsed.search}`;
  }
}

@Controller('demo')
class DemoController {
  @Get('me')
  @UseGuards(TenantGuard)
  me(@Req() req: TenantRequest) {
    return { merchantId: req.merchantId, email: req.session?.user.email };
  }

  @AllowAnonymous()
  @Post('raw')
  raw(@Req() req: RawBodyRequest, @Body() body: unknown) {
    return { rawLength: req.rawBody?.length ?? null, body };
  }
}

describeDb('email/password auth over HTTP', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: Database;
  const mailer = new CapturingMailer();

  const email = (label: string) => `${label}-${randomUUID()}@${EMAIL_DOMAIN}`;
  const server = () => app.getHttpServer();

  /** Better Auth rejects cross-site POSTs; the SPA is same-origin with APP_URL. */
  const post = (agent: request.Agent | ReturnType<typeof request>, path: string, body: object) =>
    agent.post(path).set('Origin', APP_URL).send(body);

  const signUp = (address: string, password = PASSWORD) =>
    post(request(server()), '/api/v1/auth/sign-up/email', {
      email: address,
      password,
      name: 'Nadia Rahman',
      callbackURL: '/',
    });

  /** Signs up and follows the verification link, leaving the agent signed in. */
  const verifiedSeller = async (address: string) => {
    await signUp(address).expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);
    return agent;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema });

    const env: Record<string, string> = { APP_URL, BETTER_AUTH_SECRET: 'x'.repeat(32) };

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
      controllers: [DemoController],
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

    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(like(schema.user.email, `%@${EMAIL_DOMAIN}`));
    const userIds = users.map((row) => row.id);

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

  describe('sign-up and email verification', () => {
    it('sends a verification link and refuses sign-in until it is used', async () => {
      const address = email('unverified');
      await signUp(address).expect(200);

      expect(mailer.lastTo(address).subject).toBe('Verify your email address');

      const signIn = await post(request(server()), '/api/v1/auth/sign-in/email', {
        email: address,
        password: PASSWORD,
      });

      expect(signIn.status).toBe(403);
      expect(signIn.body).toEqual({
        error: { code: 'AUTH_EMAIL_NOT_VERIFIED', message: expect.any(String), params: {} },
      });
    });

    it('re-sends the link when an unverified seller tries to sign in', async () => {
      const address = email('resend');
      await signUp(address).expect(200);
      const before = mailer.sent.filter((mail) => mail.to === address).length;

      await post(request(server()), '/api/v1/auth/sign-in/email', {
        email: address,
        password: PASSWORD,
      }).expect(403);

      expect(mailer.sent.filter((mail) => mail.to === address)).toHaveLength(before + 1);
    });

    it('verifies, signs the seller in and resolves their organization', async () => {
      const address = email('verified');
      await signUp(address).expect(200);
      expect(mailer.linkTo(address)).toMatch(/^\/api\/v1\/auth\/verify-email\?token=/);

      const agent = request.agent(server());
      const verify = await agent.get(mailer.linkTo(address));

      expect(verify.status).toBe(302);
      expect(verify.headers.location).toBe('/');
      expect(verify.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('better-auth.session_token=')]),
      );

      const me = await agent.get('/api/v1/demo/me').expect(200);
      expect(me.body).toEqual({ merchantId: expect.any(String), email: address });

      const [user] = await db.select().from(schema.user).where(eq(schema.user.email, address));
      expect(user?.emailVerified).toBe(true);
    });

    it('redirects a tampered link back to the SPA with an error', async () => {
      const response = await request(server()).get(
        '/api/v1/auth/verify-email?token=not-a-token&callbackURL=%2F',
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/?error=INVALID_TOKEN');
    });

    it('answers a tampered link without a callback in the envelope', async () => {
      const response = await request(server()).get('/api/v1/auth/verify-email?token=not-a-token');

      expect(response.body).toEqual({
        error: { code: 'AUTH_INVALID_TOKEN', message: expect.any(String), params: {} },
      });
    });

    it('answers a taken email like a fresh sign-up, and tells the owner instead', async () => {
      const address = email('taken');
      await verifiedSeller(address);

      const again = await signUp(address, 'a different password');

      expect(again.status).toBe(200);
      expect(mailer.lastTo(address).subject).toBe('You already have an account');
    });

    it('rejects a short password against the `password` field', async () => {
      const response = await signUp(email('short'), 'short');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: { password: [{ code: 'MIN_LENGTH', params: { min: 8 } }] },
      });
    });

    it('rejects a malformed email against the `email` field', async () => {
      const response = await signUp('not-an-email');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(response.body.error.fields)).toEqual(['email']);
    });
  });

  describe('sign-in and sign-out', () => {
    it('rejects a wrong password with AUTH_INVALID_CREDENTIALS', async () => {
      const address = email('wrong-password');
      await verifiedSeller(address);

      const response = await post(request(server()), '/api/v1/auth/sign-in/email', {
        email: address,
        password: 'not the password',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('signs in with the right password and out again', async () => {
      const address = email('sign-out');
      await verifiedSeller(address);

      const agent = request.agent(server());
      await post(agent, '/api/v1/auth/sign-in/email', {
        email: address,
        password: PASSWORD,
      }).expect(200);
      await agent.get('/api/v1/demo/me').expect(200);

      await post(agent, '/api/v1/auth/sign-out', {}).expect(200);

      const after = await agent.get('/api/v1/demo/me');
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('turns away a request with no session', async () => {
      const response = await request(server()).get('/api/v1/demo/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: 'AUTH_UNAUTHENTICATED', message: 'Authentication required', params: {} },
      });
    });
  });

  describe('password reset', () => {
    /** Requests a reset and follows the emailed link to the SPA's token. */
    const resetToken = async (address: string): Promise<string> => {
      await post(request(server()), '/api/v1/auth/request-password-reset', {
        email: address,
        redirectTo: '/reset-password',
      }).expect(200);

      expect(mailer.lastTo(address).subject).toBe('Reset your password');
      expect(mailer.linkTo(address)).toMatch(/^\/api\/v1\/auth\/reset-password\/[^/?]+/);

      const landing = await request(server()).get(mailer.linkTo(address)).expect(302);
      const location = new URL(landing.headers.location as string, APP_URL);
      expect(location.pathname).toBe('/reset-password');

      const token = location.searchParams.get('token');
      if (!token) {
        throw new Error(`No token in ${landing.headers.location}`);
      }
      return token;
    };

    it('sets the new password, revokes old sessions and burns the token', async () => {
      const address = email('reset');
      const oldSession = await verifiedSeller(address);
      await oldSession.get('/api/v1/demo/me').expect(200);

      const token = await resetToken(address);
      const newPassword = 'a brand new passphrase';

      await post(request(server()), '/api/v1/auth/reset-password', { token, newPassword }).expect(
        200,
      );

      // Every session from before the reset is gone.
      const revoked = await oldSession.get('/api/v1/demo/me');
      expect(revoked.body.error.code).toBe('AUTH_UNAUTHENTICATED');

      const withOld = await post(request(server()), '/api/v1/auth/sign-in/email', {
        email: address,
        password: PASSWORD,
      });
      expect(withOld.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

      await post(request(server()), '/api/v1/auth/sign-in/email', {
        email: address,
        password: newPassword,
      }).expect(200);

      // The token is single-use.
      const replay = await post(request(server()), '/api/v1/auth/reset-password', {
        token,
        newPassword: 'yet another passphrase',
      });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('refuses an expired token', async () => {
      const address = email('expired');
      await verifiedSeller(address);
      const token = await resetToken(address);

      await db
        .update(schema.verification)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.verification.identifier, `reset-password:${token}`));

      const response = await post(request(server()), '/api/v1/auth/reset-password', {
        token,
        newPassword: 'a brand new passphrase',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('rejects a short new password against the `newPassword` field', async () => {
      const response = await post(request(server()), '/api/v1/auth/reset-password', {
        token: 'irrelevant',
        newPassword: 'short',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toEqual({
        newPassword: [expect.objectContaining({ code: 'MIN_LENGTH' })],
      });
    });

    it('answers an unknown email exactly like a known one', async () => {
      const unknown = email('nobody');

      await post(request(server()), '/api/v1/auth/request-password-reset', {
        email: unknown,
        redirectTo: '/reset-password',
      }).expect(200);

      expect(mailer.sent.some((mail) => mail.to === unknown)).toBe(false);
    });
  });

  describe('mount point', () => {
    it('serves Better Auth under /api/v1/auth only', async () => {
      await request(server()).get('/api/v1/auth/ok').expect(200, { ok: true });

      const legacy = await request(server()).get('/api/auth/ok');
      expect(legacy.status).toBe(404);
      expect(legacy.body.error.code).toBe('HTTP_404');
    });
  });

  describe('non-auth routes', () => {
    it('still parse JSON and keep the raw body for signature checks', async () => {
      const payload = { object: 'page', entry: [] };
      const response = await request(server())
        .post('/api/v1/demo/raw')
        .set('content-type', 'application/json')
        .send(JSON.stringify(payload))
        .expect(201);

      expect(response.body).toEqual({
        rawLength: Buffer.byteLength(JSON.stringify(payload)),
        body: payload,
      });
    });
  });
});
