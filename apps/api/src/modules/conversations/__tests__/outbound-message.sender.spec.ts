import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto.service';
import type { AppConfig } from '../../config/app.config';
import * as schema from '../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation } from '../../database/__tests__/conversation-seeds';
import { withMerchant } from '../../database/with-merchant';
import { GraphError, type MetaGraphClient } from '../../messenger/page/meta-graph.client';
import { ConversationRepository } from '../conversation.repository';
import type { ConversationEvent } from '../events/conversation-event';
import type { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { MessageRepository } from '../message.repository';
import { OutboundMessageSender } from '../outbound-message.sender';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
let nextId = 1;

describeDb('OutboundMessageSender (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let events: ConversationEvent[];
  let sent: { token: string; psid: string; text: string }[];
  let fail: boolean;

  const graph = {
    sendText: async (token: string, psid: string, text: string) => {
      if (fail) throw new GraphError(400, 10, 'outside window');
      sent.push({ token, psid, text });
      return { messageId: `mid-out-${nextId++}` };
    },
  } as unknown as MetaGraphClient;
  const sender = () =>
    new OutboundMessageSender(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      crypto,
      graph,
      {
        publish: async (event: ConversationEvent) => void events.push(event),
      } as unknown as ConversationEventsPublisher,
    );

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });
  beforeEach(() => {
    events = [];
    sent = [];
    fail = false;
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('stages an assistant reply without pausing the assistant, then sends it', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    const scope = { merchantId: t.merchantA };
    const now = new Date();

    const row = await withMerchant(runtime.db, t.merchantA, (tx) =>
      sender().stage(tx, scope, convo, { sender: 'assistant', text: 'How many?', now }),
    );
    expect(row).toMatchObject({ sender: 'assistant', status: 'sending', text: 'How many?' });
    const [staged] = await t.db
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convo.id));
    expect(staged).toMatchObject({
      botPaused: false,
      lastMessageSender: 'assistant',
      lastMessagePreview: 'How many?',
    });

    const final = await sender().deliver(scope, {
      row,
      psid: 'psid-1',
      encryptedToken: crypto.encrypt('token-A'),
    });
    expect(final).toMatchObject({ status: 'sent' });
    expect(sent).toEqual([{ token: 'token-A', psid: 'psid-1', text: 'How many?' }]);
    expect(events).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, kind: 'message' },
    ]);
  });

  it('marks a refused send failed and still announces it', async () => {
    const convo = await seedConversation(t.db, t.merchantA);
    const scope = { merchantId: t.merchantA };
    const row = await withMerchant(runtime.db, t.merchantA, (tx) =>
      sender().stage(tx, scope, convo, { sender: 'assistant', text: 'Hi', now: new Date() }),
    );
    fail = true;

    const final = await sender().deliver(scope, {
      row,
      psid: 'psid-1',
      encryptedToken: crypto.encrypt('token-A'),
    });

    expect(final.status).toBe('failed');
    expect(events).toHaveLength(1);
  });
});
