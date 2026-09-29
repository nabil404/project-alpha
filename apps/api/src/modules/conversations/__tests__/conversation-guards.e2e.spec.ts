import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { AuthModule } from '../../auth/auth.module';
import { SessionGuard } from '../../auth/session.guard';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../database/database.module';
import * as schema from '../../database/schema/index';
import { describeDb, openRuntimeDb } from '../../database/__tests__/catalog-test-db';
import { MailService, type Mailer } from '../../mail/mail.service';
import type { MailMessage } from '../../mail/templates';
import { META_GRAPH } from '../../messenger/page/facebook-page.service';
import { ConversationsModule } from '../conversations.module';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { CONVERSATION_EVENTS_SUBSCRIBE } from '../events/redis-connections';

const APP_URL = 'http://localhost:5173';
const EMAIL_DOMAIN = `${randomUUID()}.example.test`;
const PASSWORD = 'correct horse battery';
const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  dispatch(message: MailMessage): void {
    this.sent.push(message);
  }

  /** The link in the most recent message to `to`, as a path on this server. */
  linkTo(to: string): string {
    const text = this.sent.filter((mail) => mail.to === to).at(-1)?.text ?? '';
    const link = /https?:\/\/\S+/.exec(text)?.[0];
    if (!link) throw new Error(`No link in the last mail to ${to}`);
    const parsed = new URL(link);
    return `${parsed.pathname}${parsed.search}`;
  }
}

/**
 * The conversations routes behind the guards production uses: SessionGuard
 * registered globally as AppModule does, and the controller's own TenantGuard,
 * neither overridden.
 */
describeDb('conversations routes behind the real guards', () => {
  let app: INestApplication;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let admin: Pool;
  const mailer = new CapturingMailer();
  const server = () => app.getHttpServer();

  const unauthenticated = {
    error: { code: 'AUTH_UNAUTHENTICATED', message: 'Authentication required', params: {} },
  };

  beforeAll(async () => {
    runtime = openRuntimeDb();
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 1 });
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL,
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      REDIS_URL: 'redis://127.0.0.1:1',
    };

    @Global()
    @Module({
      providers: [
        { provide: DATABASE, useValue: runtime.db },
        { provide: AppConfig, useValue: { get: (key: string) => env[key] } },
      ],
      exports: [DATABASE, AppConfig],
    })
    class TestInfrastructureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestInfrastructureModule, AuthModule, ConversationsModule],
      providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
    })
      .overrideProvider(MailService)
      .useValue(mailer)
      .overrideProvider(ConversationEventsPublisher)
      .useValue({ publish: async () => {} })
      .overrideProvider(CONVERSATION_EVENTS_SUBSCRIBE)
      .useValue(async () => ({ close: async () => {} }))
      .overrideProvider(META_GRAPH)
      .useValue(null)
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
    if (admin) {
      const db = drizzle(admin, { schema });
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
      await admin.end();
    }
    await runtime?.close();
  });

  it.each(['/api/v1/conversations', '/api/v1/conversations/events'])(
    'turns away %s without a session',
    async (path) => {
      const response = await request(server()).get(path);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    },
  );

  it('refuses a signed-in session with no active merchant', async () => {
    const address = `no-merchant-${randomUUID()}@${EMAIL_DOMAIN}`;
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', APP_URL)
      .send({
        email: address,
        password: PASSWORD,
        name: 'Nadia Rahman',
        shopName: "Nadia's Kitchen",
        phone: '01712-345678',
        callbackURL: '/',
      })
      .expect(200);
    const agent = request.agent(server());
    await agent.get(mailer.linkTo(address)).expect(302);

    // Signed in with the shop active: the guard lets the list through.
    await agent.get('/api/v1/conversations').expect(200);

    // Clearing the active organization is the one way a real session loses it.
    await agent
      .post('/api/v1/auth/organization/set-active')
      .set('Origin', APP_URL)
      .send({ organizationId: null })
      .expect(200);

    for (const path of ['/api/v1/conversations', '/api/v1/conversations/events']) {
      const response = await agent.get(path);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: {
          code: 'TENANT_NO_ACTIVE_MERCHANT',
          message: 'No active merchant for this session',
          params: {},
        },
      });
    }
  });
});
