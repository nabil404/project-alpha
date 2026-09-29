import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  Global,
  Module,
  type ExecutionContext,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../../auth/auth.module';
import { configureApp, NEST_APP_OPTIONS } from '../../../bootstrap';
import { TenantGuard } from '../../../common/tenant.guard';
import { AppConfig } from '../../config/app.config';
import { DATABASE } from '../../database/database.module';
import { describeDb, openRuntimeDb } from '../../database/__tests__/catalog-test-db';
import { MailService } from '../../mail/mail.service';
import { META_GRAPH } from '../../messenger/page/facebook-page.service';
import { ConversationsModule } from '../conversations.module';
import { ConversationEventsHub, MAX_STREAMS_PER_MERCHANT } from '../events/conversation-events.hub';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { CONVERSATION_EVENTS_SUBSCRIBE } from '../events/redis-connections';

const silentLogger = { error: () => {}, log: () => {}, warn: () => {} } as unknown as LoggerService;
const A = 'merchant-a';
const B = 'merchant-b';

/** Reads the stream until `done(text)` holds, or fails after two seconds. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: (text: string) => boolean,
  text = '',
): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + 2_000;
  while (!done(text)) {
    if (Date.now() > deadline) throw new Error(`stream never matched; got:\n${text}`);
    const { value, done: ended } = await reader.read();
    if (ended) break;
    text += decoder.decode(value);
  }
  return text;
}

/**
 * The SSE route over a real socket. AuthModule is mounted, as in every e2e
 * spec, so it gets the real runtime database; the stream itself reads nothing.
 */
describeDb('GET /conversations/events', () => {
  let app: INestApplication;
  let base: string;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeAll(async () => {
    runtime = openRuntimeDb();
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
      .useValue({ publish: async () => {} })
      .overrideProvider(CONVERSATION_EVENTS_SUBSCRIBE)
      .useValue(async () => ({ close: async () => {} }))
      .overrideProvider(META_GRAPH)
      .useValue(null)
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.merchantId = A;
          request.session = { session: { expiresAt: new Date(Date.now() + 3_600_000) } };
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
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.close();
  });

  it("streams the merchant's own conversation ids, and nobody else's", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/v1/conversations/events`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();

    const opened = await readUntil(reader, (text) => text.includes('event: ready'));
    expect(opened).toContain('retry: 5000');

    const hub = app.get(ConversationEventsHub);
    const mine = randomUUID();
    const theirs = randomUUID();
    hub.dispatch(JSON.stringify({ merchantId: B, conversationId: theirs, kind: 'message' }));
    hub.dispatch(JSON.stringify({ merchantId: A, conversationId: mine, kind: 'message' }));

    const text = await readUntil(reader, (body) => body.includes(mine), opened);
    expect(text).toContain('event: conversation.updated');
    expect(text).not.toContain(theirs);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('tells the oldest stream it was evicted before closing it, when a sixth opens', async () => {
    const controllers: AbortController[] = [];
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    // One at a time, each open before the next, so the first is the oldest.
    for (let n = 0; n <= MAX_STREAMS_PER_MERCHANT; n++) {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/v1/conversations/events`, {
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      await readUntil(reader, (text) => text.includes('event: ready'));
      controllers.push(controller);
      readers.push(reader);
    }

    // Written before the response ends, so the browser sees it; then the socket closes.
    const [oldest, ...open] = readers;
    expect(await readUntil(oldest!, (text) => text.includes('event: evicted'))).toContain(
      'event: evicted',
    );
    await expect(oldest!.read()).resolves.toMatchObject({ done: true });

    controllers.forEach((controller) => controller.abort());
    await Promise.all(open.map((reader) => reader.cancel().catch(() => undefined)));
  });
});
