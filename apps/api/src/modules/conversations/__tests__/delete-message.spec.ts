import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { CryptoService } from '../../../common/crypto.service';
import type { AppConfig } from '../../config/app.config';
import type { Transaction } from '../../database/base.repository';
import * as schema from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';
import { seedConversation, seedMessage } from '../../database/__tests__/conversation-seeds';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { ConversationRepository } from '../conversation.repository';
import { ConversationsService } from '../conversations.service';
import type { ConversationEvent } from '../events/conversation-event';
import type { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { MessageRepository } from '../message.repository';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
const minute = (n: number) => new Date(Date.UTC(2026, 8, 30, 10, n));

describeDb('deleting a reply that was not delivered (app_runtime, two merchants)', () => {
  const messages = new MessageRepository();
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let events: ConversationEvent[];

  const service = () =>
    new ConversationsService(
      runtime.db,
      new ConversationRepository(),
      messages,
      new FacebookPageRepository(),
      crypto,
      null,
      {
        publish: async (event: ConversationEvent) => void events.push(event),
      } as unknown as ConversationEventsPublisher,
    );

  /**
   * A customer's question at minute 1, then a failed seller reply at minute 2,
   * which (as the send path does) moved the list preview and paused the bot.
   */
  const threadWithFailedReply = async (merchantId: string) => {
    const convo = await seedConversation(t.db, merchantId, {
      lastMessageAt: minute(2),
      lastMessagePreview: 'Ships today',
      lastMessageSender: 'seller',
      lastInboundAt: minute(1),
      botPaused: true,
    });
    const question = await seedMessage(t.db, merchantId, convo.id, {
      text: 'When does it ship?',
      sentAt: minute(1),
    });
    const failed = await seedMessage(t.db, merchantId, convo.id, {
      sender: 'seller',
      text: 'Ships today',
      status: 'failed',
      metaMessageId: null,
      sentAt: minute(2),
    });
    return { convo, question, failed };
  };
  const messageIds = async (conversationId: string) =>
    (
      await t.db
        .select({ id: schema.message.id })
        .from(schema.message)
        .where(eq(schema.message.conversationId, conversationId))
    ).map(({ id }) => id);
  const conversationRow = async (id: string) =>
    (await t.db.select().from(schema.conversation).where(eq(schema.conversation.id, id)))[0];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  beforeEach(() => {
    events = [];
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('deletes it, moves the preview back to the newest message left, and announces it', async () => {
    const { convo, question, failed } = await threadWithFailedReply(t.merchantA);

    await service().deleteMessage({ merchantId: t.merchantA }, convo.id, failed.id);

    expect(await messageIds(convo.id)).toEqual([question.id]);
    expect(await conversationRow(convo.id)).toMatchObject({
      lastMessageAt: minute(1),
      lastMessagePreview: 'When does it ship?',
      lastMessageSender: 'customer',
      // The seller took over by replying; deleting the reply doesn't hand the chat back.
      botPaused: true,
    });
    expect(events).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, kind: 'message' },
    ]);
  });

  it.each([
    ['a delivered seller reply', { sender: 'seller', status: 'sent' }],
    ['a seller reply still sending', { sender: 'seller', status: 'sending', metaMessageId: null }],
    ["the assistant's message", { sender: 'assistant', status: 'sent' }],
    ["the customer's message", { sender: 'customer', status: 'sent' }],
  ] as const)('refuses %s and keeps it', async (_, overrides) => {
    const { convo } = await threadWithFailedReply(t.merchantA);
    const kept = await seedMessage(t.db, t.merchantA, convo.id, {
      ...overrides,
      sentAt: minute(3),
    });

    await expectCoded(
      service().deleteMessage({ merchantId: t.merchantA }, convo.id, kept.id),
      'MESSAGE_NOT_DELETABLE',
    );
    expect(await messageIds(convo.id)).toContain(kept.id);
    expect(events).toEqual([]);
  });

  it("answers a message from another of the shop's conversations as missing", async () => {
    const first = await threadWithFailedReply(t.merchantA);
    const second = await threadWithFailedReply(t.merchantA);

    await expectCoded(
      service().deleteMessage({ merchantId: t.merchantA }, second.convo.id, first.failed.id),
      'MESSAGE_NOT_FOUND',
    );
    expect(await messageIds(first.convo.id)).toContain(first.failed.id);
  });

  it("answers another merchant's conversation as missing and deletes nothing", async () => {
    const { convo, failed } = await threadWithFailedReply(t.merchantA);

    await expectCoded(
      service().deleteMessage({ merchantId: t.merchantB }, convo.id, failed.id),
      'CONVERSATION_NOT_FOUND',
    );
    expect(await messageIds(convo.id)).toContain(failed.id);
    expect(events).toEqual([]);
  });

  // Runs in A's context, where RLS shows A's rows, and passes B's scope: only
  // the repository's own merchantId filter can hide them.
  describe('filter, not policy', () => {
    const other = () => ({ merchantId: t.merchantB });
    const asA = <T>(fn: (tx: Transaction) => Promise<T>) =>
      withMerchant(t.db, t.merchantA, async (tx) => {
        await tx.execute(sql`set local role app_runtime`);
        return fn(tx);
      });

    it('findInConversation and latest find nothing', async () => {
      const { convo, failed } = await threadWithFailedReply(t.merchantA);

      await expect(
        asA((tx) => messages.findInConversation(tx, other(), convo.id, failed.id)),
      ).resolves.toBeNull();
      await expect(asA((tx) => messages.latest(tx, other(), convo.id))).resolves.toBeNull();
    });

    it('deleteFailed deletes nothing', async () => {
      const { convo, failed } = await threadWithFailedReply(t.merchantA);

      await expect(
        asA((tx) => messages.deleteFailed(tx, other(), convo.id, failed.id)),
      ).resolves.toBe(false);
      expect(await messageIds(convo.id)).toContain(failed.id);
    });
  });
});
