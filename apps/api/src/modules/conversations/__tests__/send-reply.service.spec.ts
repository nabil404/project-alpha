import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto.service';
import type { AppConfig } from '../../config/app.config';
import * as schema from '../../database/schema/index';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedFacebookPage,
} from '../../database/__tests__/conversation-seeds';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../messenger/page/meta-graph.client';
import { ConversationRepository } from '../conversation.repository';
import { ConversationsService } from '../conversations.service';
import type { ConversationEvent } from '../events/conversation-event';
import type { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { MessageRepository } from '../message.repository';
import { OutboundMessageSender } from '../outbound-message.sender';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
const HOUR = 3_600_000;

// Shared across instances: Meta message ids are unique per merchant, and the
// rows outlive each test's FakeGraph, so the ids must not restart at m_1.
let nextMessageId = 1;

class FakeGraph {
  sent: { token: string; psid: string; text: string }[] = [];
  fail = false;
  async sendText(token: string, psid: string, text: string) {
    if (this.fail) throw new GraphError(400, 10, 'outside window');
    this.sent.push({ token, psid, text });
    return { messageId: `m_${nextMessageId++}` };
  }
}

describeDb('ConversationsService.send (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let graph: FakeGraph;
  let events: ConversationEvent[];

  const service = (withGraph: MetaGraphClient | null = graph as unknown as MetaGraphClient) => {
    const publisher = {
      publish: async (event: ConversationEvent) => void events.push(event),
    } as unknown as ConversationEventsPublisher;
    return new ConversationsService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      withGraph,
      publisher,
      new OutboundMessageSender(
        runtime.db,
        new ConversationRepository(),
        new MessageRepository(),
        crypto,
        withGraph,
        publisher,
      ),
    );
  };
  const threadFor = async (
    merchantId: string,
    lastInboundAgoMs: number,
    facebookPageId = pageA,
  ) => {
    const customer = await seedCustomer(t.db, merchantId, { psid: `psid-${Math.random()}` });
    const at = new Date(Date.now() - lastInboundAgoMs);
    const convo = await seedConversation(t.db, merchantId, {
      customerId: customer.id,
      facebookPageId,
      lastMessageAt: at,
      lastInboundAt: at,
    });
    return { convo, customer };
  };
  const messagesOf = (conversationId: string) =>
    t.db.select().from(schema.message).where(eq(schema.message.conversationId, conversationId));
  const conversationRow = async (id: string) =>
    (await t.db.select().from(schema.conversation).where(eq(schema.conversation.id, id)))[0];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    pageA = (await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') }))
      .pageId;
  });

  beforeEach(() => {
    graph = new FakeGraph();
    events = [];
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('sends the reply with the Page token, stores it as sent, and pauses the assistant', async () => {
    const { convo, customer } = await threadFor(t.merchantA, HOUR);

    const message = await service().send({ merchantId: t.merchantA }, convo.id, {
      text: 'Ships today',
    });

    expect(message).toMatchObject({ sender: 'seller', text: 'Ships today', status: 'sent' });
    expect(graph.sent).toEqual([{ token: 'token-A', psid: customer.psid, text: 'Ships today' }]);
    expect(await messagesOf(convo.id)).toMatchObject([{ status: 'sent', metaMessageId: 'm_1' }]);
    expect(await conversationRow(convo.id)).toMatchObject({
      botPaused: true,
      lastMessagePreview: 'Ships today',
      lastMessageSender: 'seller',
    });
    expect(events).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, kind: 'message' },
    ]);
  });

  it('refuses a reply after the 24h window and stores nothing', async () => {
    const { convo } = await threadFor(t.merchantA, 25 * HOUR);

    await expectCoded(
      service().send({ merchantId: t.merchantA }, convo.id, { text: 'late' }),
      'MESSENGER_WINDOW_CLOSED',
    );
    expect(graph.sent).toEqual([]);
    expect(await messagesOf(convo.id)).toEqual([]);
  });

  it('keeps a reply Messenger refused as failed, still paused, and answers 502', async () => {
    const { convo } = await threadFor(t.merchantA, HOUR);
    graph.fail = true;

    await expectCoded(
      service().send({ merchantId: t.merchantA }, convo.id, { text: 'hello' }),
      'MESSENGER_SEND_FAILED',
    );
    expect(await messagesOf(convo.id)).toMatchObject([{ status: 'failed', metaMessageId: null }]);
    expect((await conversationRow(convo.id))?.botPaused).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('refuses when the conversation’s Page is no longer the connected one', async () => {
    const { convo } = await threadFor(t.merchantA, HOUR, 'an-old-page');
    await expectCoded(
      service().send({ merchantId: t.merchantA }, convo.id, { text: 'hello' }),
      'MESSENGER_PAGE_NOT_CONNECTED',
    );
    expect(await messagesOf(convo.id)).toEqual([]);
  });

  it('refuses when the shop has no Page connected', async () => {
    const { convo } = await threadFor(t.merchantB, HOUR, 'any-page');
    await expectCoded(
      service().send({ merchantId: t.merchantB }, convo.id, { text: 'hello' }),
      'MESSENGER_PAGE_NOT_CONNECTED',
    );
  });

  it("answers another merchant's conversation as missing and sends nothing", async () => {
    const { convo } = await threadFor(t.merchantA, HOUR);
    await expectCoded(
      service().send({ merchantId: t.merchantB }, convo.id, { text: 'hello' }),
      'CONVERSATION_NOT_FOUND',
    );
    expect(graph.sent).toEqual([]);
    expect(await messagesOf(convo.id)).toEqual([]);
  });

  it('says Messenger is not configured when the app has no Facebook credentials', async () => {
    const { convo } = await threadFor(t.merchantA, HOUR);
    await expectCoded(
      service(null).send({ merchantId: t.merchantA }, convo.id, { text: 'hello' }),
      'MESSENGER_NOT_CONFIGURED',
    );
  });

  it('keeps sending after the same Page is disconnected and reconnected', async () => {
    const { convo } = await threadFor(t.merchantA, HOUR);
    await t.db.delete(schema.facebookPage).where(eq(schema.facebookPage.merchantId, t.merchantA));
    await seedFacebookPage(t.db, t.merchantA, {
      pageId: pageA,
      accessToken: crypto.encrypt('token-A2'),
    });

    await service().send({ merchantId: t.merchantA }, convo.id, { text: 'still here' });
    expect(graph.sent.at(-1)?.token).toBe('token-A2');
  });
});
