import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  conversationCountsSchema,
  conversationDetailSchema,
  conversationListResponseSchema,
  messagePageSchema,
} from '@app/shared';
import request from 'supertest';
import { AuthModule } from '../../../auth/auth.module';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { TenantGuard } from '../../../common/tenant.guard';
import { AppConfig } from '../../../config/app.config';
import { DATABASE } from '../../../database/database.module';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedMessage,
} from '../../../database/__tests__/conversation-seeds';
import { MailService } from '../../mail/mail.service';
import { META_GRAPH } from '../../messenger/page/facebook-page.service';
import type { ConversationEvent } from '../events/conversation-event';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { CONVERSATION_EVENTS_SUBSCRIBE } from '../events/redis-connections';
import { ConversationsModule } from '../conversations.module';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;

/**
 * Over real HTTP with AuthModule mounted (it owns body parsing), connected as
 * app_runtime so RLS applies. The tenant guard is stubbed to a switchable
 * merchant; session handling has its own e2e spec.
 */
describeDb('conversation routes over HTTP', () => {
  let app: INestApplication;
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let merchantId: string;
  const events: ConversationEvent[] = [];
  const server = () => app.getHttpServer();
  let handedOff: string;
  let drafted: string;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();

    const nusrat = await seedCustomer(t.db, t.merchantA, { name: 'Nusrat Jahan' });
    const now = Date.now();
    handedOff = (
      await seedConversation(t.db, t.merchantA, {
        customerId: nusrat.id,
        state: 'handed_off',
        lastMessageAt: new Date(now - 60_000),
        lastInboundAt: new Date(now - 60_000),
      })
    ).id;
    drafted = (
      await seedConversation(t.db, t.merchantA, {
        state: 'awaiting_confirmation',
        lastMessageAt: new Date(now - 120_000),
        lastInboundAt: new Date(now - 120_000),
        sellerLastReadAt: new Date(now),
      })
    ).id;
    await seedMessage(t.db, t.merchantA, handedOff, {
      text: 'first',
      sentAt: new Date(now - 90_000),
    });
    await seedMessage(t.db, t.merchantA, handedOff, {
      text: 'second',
      sentAt: new Date(now - 60_000),
    });

    const env: Record<string, string> = {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:5173',
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
    })
      .overrideProvider(MailService)
      .useValue({ dispatch: () => {} })
      .overrideProvider(ConversationEventsPublisher)
      .useValue({ publish: async (event: ConversationEvent) => void events.push(event) })
      .overrideProvider(CONVERSATION_EVENTS_SUBSCRIBE)
      .useValue(async () => ({ close: async () => {} }))
      .overrideProvider(META_GRAPH)
      .useValue(null)
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ merchantId?: string }>().merchantId = merchantId;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({
      ...NEST_APP_OPTIONS,
      bufferLogs: false,
      logger: false,
    });
    configureApp(app, silentLogger);
    await app.init();
  });

  beforeEach(() => {
    merchantId = t.merchantA;
    events.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.close();
    await t.close();
  });

  it('lists conversations newest first, and pages with the cursor it returns', async () => {
    const all = await request(server()).get('/api/v1/conversations').expect(200);
    const body = conversationListResponseSchema.parse(all.body);
    expect(body.data.map((item) => item.id)).toEqual([handedOff, drafted]);
    expect(body.data[0]).toMatchObject({
      customer: { name: 'Nusrat Jahan' },
      state: 'handed_off',
      unread: true,
    });
    expect(body.data[1]?.unread).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();

    const first = conversationListResponseSchema.parse(
      (await request(server()).get('/api/v1/conversations?limit=1').expect(200)).body,
    );
    const second = conversationListResponseSchema.parse(
      (
        await request(server())
          .get(`/api/v1/conversations?limit=1&cursor=${first.pagination.nextCursor}`)
          .expect(200)
      ).body,
    );
    expect([...first.data, ...second.data].map((item) => item.id)).toEqual([handedOff, drafted]);
    expect(second.pagination.nextCursor).toBeNull();
  });

  it('filters and counts', async () => {
    const needsYou = conversationListResponseSchema.parse(
      (await request(server()).get('/api/v1/conversations?filter=needs_you').expect(200)).body,
    );
    expect(needsYou.data.map((item) => item.id)).toEqual([handedOff]);

    const counts = conversationCountsSchema.parse(
      (await request(server()).get('/api/v1/conversations/counts').expect(200)).body,
    );
    expect(counts).toEqual({ all: 2, needsYou: 1, drafted: 1, unread: 1 });
  });

  it('refuses a cursor it did not issue, and a malformed id', async () => {
    const bad = await request(server()).get('/api/v1/conversations?cursor=garbage').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await request(server()).get('/api/v1/conversations/not-a-uuid').expect(400);
  });

  it('shows one conversation and its thread in order', async () => {
    const detail = conversationDetailSchema.parse(
      (await request(server()).get(`/api/v1/conversations/${handedOff}`).expect(200)).body,
    );
    expect(detail).toMatchObject({
      id: handedOff,
      customer: { name: 'Nusrat Jahan' },
      botPaused: false,
    });
    expect(detail.replyWindowClosesAt).not.toBeNull();

    const thread = messagePageSchema.parse(
      (await request(server()).get(`/api/v1/conversations/${handedOff}/messages`).expect(200)).body,
    );
    expect(thread.data.map((item) => item.text)).toEqual(['first', 'second']);

    const older = messagePageSchema.parse(
      (
        await request(server())
          .get(`/api/v1/conversations/${handedOff}/messages?limit=1`)
          .expect(200)
      ).body,
    );
    expect(older.data.map((item) => item.text)).toEqual(['second']);
    expect(older.pagination.prevCursor).not.toBeNull();
  });

  it('marks a conversation read and announces it', async () => {
    await request(server()).put(`/api/v1/conversations/${handedOff}/read`).expect(204);
    const detail = conversationDetailSchema.parse(
      (await request(server()).get(`/api/v1/conversations/${handedOff}`).expect(200)).body,
    );
    expect(detail.unread).toBe(false);
    expect(events).toEqual([
      { merchantId: t.merchantA, conversationId: handedOff, kind: 'conversation' },
    ]);
  });

  it('takes over and hands back, restoring a handed-off conversation', async () => {
    const paused = conversationDetailSchema.parse(
      (
        await request(server())
          .patch(`/api/v1/conversations/${handedOff}`)
          .send({ botPaused: true })
          .expect(200)
      ).body,
    );
    expect(paused).toMatchObject({ botPaused: true, state: 'handed_off' });

    const handedBack = conversationDetailSchema.parse(
      (
        await request(server())
          .patch(`/api/v1/conversations/${handedOff}`)
          .send({ botPaused: false })
          .expect(200)
      ).body,
    );
    expect(handedBack).toMatchObject({ botPaused: false, state: 'browsing' });

    const refused = await request(server())
      .patch(`/api/v1/conversations/${handedOff}`)
      .send({ botPaused: false, state: 'confirmed' })
      .expect(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it("answers another merchant's conversation as missing, everywhere", async () => {
    merchantId = t.merchantB;
    const list = conversationListResponseSchema.parse(
      (await request(server()).get('/api/v1/conversations').expect(200)).body,
    );
    expect(list.data).toEqual([]);

    // Lazy: supertest starts listening when a request is built and stops when it
    // ends, so building all four up front would leave three on a closed port.
    const calls = [
      () => request(server()).get(`/api/v1/conversations/${handedOff}`),
      () => request(server()).get(`/api/v1/conversations/${handedOff}/messages`),
      () => request(server()).put(`/api/v1/conversations/${handedOff}/read`),
      () => request(server()).patch(`/api/v1/conversations/${handedOff}`).send({ botPaused: true }),
    ];
    for (const call of calls) {
      const response = await call().expect(404);
      expect(response.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    }
    expect(events).toEqual([]);
  });
});
