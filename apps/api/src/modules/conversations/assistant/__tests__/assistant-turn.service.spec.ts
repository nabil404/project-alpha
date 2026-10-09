import { Logger } from '@nestjs/common';
import type { ExtractedOrder, IntentResult } from '@app/shared';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedFacebookPage,
  seedMessage,
} from '../../../database/__tests__/conversation-seeds';
import type { LlmClient, LlmPurpose, LlmResult } from '../../../llm/llm.types';
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../../messenger/page/meta-graph.client';
import type { NotificationsService } from '../../../notifications/notifications.service';
import { MerchantSettingsRepository } from '../../../settings/merchant-settings.repository';
import { ConversationRepository } from '../../conversation.repository';
import { ConversationsService } from '../../conversations.service';
import type { ConversationEventsPublisher } from '../../events/conversation-events.publisher';
import { MessageRepository } from '../../message.repository';
import { OutboundMessageSender } from '../../outbound-message.sender';
import { fallbackText } from '../assistant-fallbacks';
import { AssistantTurnService } from '../assistant-turn.service';
import { LlmCallRepository } from '../llm-call.repository';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
const usage = (purpose: LlmPurpose) => ({
  purpose,
  model: 'fake',
  inputTokens: 10,
  outputTokens: 3,
  latencyMs: 5,
});
const ok = <T>(value: T, purpose: LlmPurpose): LlmResult<T> => ({
  ok: true,
  value,
  usage: usage(purpose),
});
const failed = <T>(purpose: LlmPurpose): LlmResult<T> => ({
  ok: false,
  reason: 'timeout',
  usage: usage(purpose),
});
const NOTHING: ExtractedOrder = {
  productName: null,
  variantName: null,
  quantity: null,
  customerName: null,
  phone: null,
  deliveryAddress: null,
  confidence: 0.9,
};
let nextMid = 1;

class FakeLlm implements LlmClient {
  intent: LlmResult<IntentResult> = ok({ intent: 'browse', confidence: 0.9 }, 'classify');
  extraction: LlmResult<ExtractedOrder> = ok(NOTHING, 'extract');
  phrase: LlmResult<string> = ok('Which product would you like?', 'phrase');
  calls: LlmPurpose[] = [];
  onClassify: () => Promise<void> = async () => undefined;
  async classifyIntent() {
    this.calls.push('classify');
    await this.onClassify();
    return this.intent;
  }
  async extractOrder() {
    this.calls.push('extract');
    return this.extraction;
  }
  async phraseReply() {
    this.calls.push('phrase');
    return this.phrase;
  }
}

describeDb('AssistantTurnService (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let pageB: string;
  let llm: FakeLlm;
  let sent: { psid: string; text: string }[];
  let graphFails: boolean;
  let notifyFailures: number;
  let handoffs: { merchantId: string; conversationId: string; at: Date }[];

  const graph = {
    sendText: async (_token: string, psid: string, text: string) => {
      if (graphFails) throw new GraphError(400, 10, 'outside window');
      sent.push({ psid, text });
      return { messageId: `mid-turn-${nextMid++}` };
    },
  } as unknown as MetaGraphClient;

  const service = (client: LlmClient | null = llm) => {
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    return new AssistantTurnService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      new MerchantSettingsRepository(),
      new LlmCallRepository(),
      client,
      new OutboundMessageSender(
        runtime.db,
        new ConversationRepository(),
        new MessageRepository(),
        crypto,
        graph,
        publisher,
      ),
      {
        handedOff: async (merchantId: string, conversationId: string, at: Date) => {
          if (notifyFailures > 0) {
            notifyFailures -= 1;
            throw new Error('queue down');
          }
          handoffs.push({ merchantId, conversationId, at });
        },
      } as unknown as NotificationsService,
    );
  };

  /** A conversation whose newest message is a customer's, sent at `sentAt` (a second ago by default). */
  const thread = async (
    merchantId = t.merchantA,
    overrides: Partial<typeof schema.conversation.$inferInsert> = {},
    sentAt = new Date(Date.now() - 1_000),
  ) => {
    const customer = await seedCustomer(t.db, merchantId);
    const convo = await seedConversation(t.db, merchantId, {
      customerId: customer.id,
      facebookPageId: merchantId === t.merchantA ? pageA : pageB,
      lastMessageAt: sentAt,
      lastInboundAt: sentAt,
      ...overrides,
    });
    const trigger = await seedMessage(t.db, merchantId, convo.id, { sentAt, text: 'hi' });
    return {
      convo,
      customer,
      trigger,
      job: { merchantId, conversationId: convo.id, triggerMessageId: trigger.id },
    };
  };
  const conversationRow = async (id: string) =>
    (await t.db.select().from(schema.conversation).where(eq(schema.conversation.id, id)))[0];
  const messagesOf = (id: string) =>
    t.db.select().from(schema.message).where(eq(schema.message.conversationId, id));
  const llmCallsOf = (id: string) =>
    t.db.select().from(schema.llmCall).where(eq(schema.llmCall.conversationId, id));

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    pageA = (await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') }))
      .pageId;
    pageB = (await seedFacebookPage(t.db, t.merchantB, { accessToken: crypto.encrypt('token-B') }))
      .pageId;
    await t.db.insert(schema.merchantSettings).values({
      merchantId: t.merchantB,
      country: 'GB',
      currency: 'GBP',
      timeZone: 'Europe/London',
      dateFormat: 'dd/MM/yyyy',
    });
  });
  beforeEach(() => {
    llm = new FakeLlm();
    sent = [];
    graphFails = false;
    handoffs = [];
    notifyFailures = 0;
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('answers with the phrased reply and records every call', async () => {
    const { convo, customer, job } = await thread();

    await expect(service().run(job)).resolves.toBe('replied');

    expect(llm.calls).toEqual(['classify', 'phrase']);
    expect(sent).toEqual([{ psid: customer.psid, text: 'Which product would you like?' }]);
    expect(await conversationRow(convo.id)).toMatchObject({
      state: 'browsing',
      collectedSlots: { lastAsked: { slot: 'product', times: 1 } },
      lastMessageSender: 'assistant',
      botPaused: false,
    });
    expect((await messagesOf(convo.id)).find((m) => m.sender === 'assistant')).toMatchObject({
      status: 'sent',
    });
    expect(await llmCallsOf(convo.id)).toHaveLength(2);
    expect(handoffs).toEqual([]);
  });

  it('hands off with the fixed reply when the LLM fails, and emails the seller', async () => {
    llm.intent = failed('classify');
    const { convo, job } = await thread();

    await expect(service().run(job)).resolves.toBe('handed_off');

    expect(sent.map((s) => s.text)).toEqual([
      fallbackText({ kind: 'handoff', reason: 'llm_failed' }, 'bn'),
    ]);
    const row = await conversationRow(convo.id);
    expect(row).toMatchObject({ state: 'handed_off' });
    expect(row?.handedOffAt).toBeInstanceOf(Date);
    expect(handoffs).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, at: row?.handedOffAt },
    ]);
    expect(await llmCallsOf(convo.id)).toEqual([expect.objectContaining({ outcome: 'timeout' })]);
  });

  it('hands off with the fixed reply when no LLM is configured', async () => {
    const { convo, job } = await thread();

    await expect(service(null).run(job)).resolves.toBe('handed_off');

    expect(sent.map((s) => s.text)).toEqual([
      fallbackText({ kind: 'handoff', reason: 'llm_failed' }, 'bn'),
    ]);
    expect((await conversationRow(convo.id))?.state).toBe('handed_off');
  });

  it('makes no LLM call for a paused conversation', async () => {
    const { job } = await thread(t.merchantA, { botPaused: true });
    await expect(service().run(job)).resolves.toBe('paused');
    expect(llm.calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('answers a burst once, from its last message', async () => {
    const { convo, job: first } = await thread();
    const later = await seedMessage(t.db, t.merchantA, convo.id, {
      sentAt: new Date(),
      text: 'red saree',
    });

    await expect(service().run(first)).resolves.toBe('stale');
    expect(llm.calls).toEqual([]);
    await expect(service().run({ ...first, triggerMessageId: later.id })).resolves.toBe('replied');
    expect(sent).toHaveLength(1);
  });

  it('a retried turn sends nothing twice', async () => {
    const { job } = await thread();
    await service().run(job);
    llm.calls = [];

    await expect(service().run(job)).resolves.toBe('answered');

    expect(llm.calls).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('catches a seller takeover during the LLM call: records the calls, sends nothing', async () => {
    const { convo, job } = await thread();
    llm.onClassify = async () => {
      await t.db
        .update(schema.conversation)
        .set({ botPaused: true })
        .where(eq(schema.conversation.id, convo.id));
    };

    await expect(service().run(job)).resolves.toBe('paused');

    expect(sent).toEqual([]);
    expect((await messagesOf(convo.id)).filter((m) => m.sender === 'assistant')).toEqual([]);
    expect(await llmCallsOf(convo.id)).toHaveLength(2);
  });

  it('marks a refused send failed and hands the chat off', async () => {
    graphFails = true;
    const { convo, job } = await thread();

    await expect(service().run(job)).resolves.toBe('send_failed');

    expect((await messagesOf(convo.id)).find((m) => m.sender === 'assistant')).toMatchObject({
      status: 'failed',
    });
    const row = await conversationRow(convo.id);
    expect(row?.state).toBe('handed_off');
    expect(handoffs).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, at: row?.handedOffAt },
    ]);
  });

  it('sends the fixed sentence when phrasing fails', async () => {
    llm.phrase = failed('phrase');
    const { job } = await thread();

    await expect(service().run(job)).resolves.toBe('replied');

    expect(sent.map((s) => s.text)).toEqual([
      fallbackText(
        { kind: 'ask_slot', slot: 'product', intent: 'browse', invalidPhone: false, facts: {} },
        'bn',
      ),
    ]);
  });

  it('sends the fixed sentence when the phrased reply invents a number', async () => {
    llm.phrase = ok('Our sarees are 1500 taka. Which one?', 'phrase');
    const { job } = await thread();

    await service().run(job);

    expect(sent.map((s) => s.text)).toEqual([
      fallbackText(
        { kind: 'ask_slot', slot: 'product', intent: 'browse', invalidPhone: false, facts: {} },
        'bn',
      ),
    ]);
  });

  it('falls back in English for a shop outside Bangladesh', async () => {
    llm.phrase = failed('phrase');
    const { job } = await thread(t.merchantB);

    await service().run(job);

    expect(sent.map((s) => s.text)).toEqual([
      fallbackText(
        { kind: 'ask_slot', slot: 'product', intent: 'browse', invalidPhone: false, facts: {} },
        'en',
      ),
    ]);
  });

  it('reads unreadable slots as empty', async () => {
    const { convo, job } = await thread(t.merchantA, { collectedSlots: { quantity: 'two' } });

    await expect(service().run(job)).resolves.toBe('replied');

    expect((await conversationRow(convo.id))?.collectedSlots).toEqual({
      lastAsked: { slot: 'product', times: 1 },
    });
  });

  it('starts the repeat count afresh after the seller hands the chat back', async () => {
    llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
    const { convo, job } = await thread(t.merchantA, {
      state: 'handed_off',
      botPaused: true,
      collectedSlots: { productText: 'red saree', lastAsked: { slot: 'quantity', times: 2 } },
    });
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    const conversations = new ConversationsService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      null,
      publisher,
      {} as unknown as OutboundMessageSender,
    );

    await conversations.update({ merchantId: t.merchantA }, convo.id, { botPaused: false });
    await expect(service().run(job)).resolves.toBe('replied');

    expect(await conversationRow(convo.id)).toMatchObject({
      state: 'collecting_details',
      collectedSlots: { productText: 'red saree', lastAsked: { slot: 'quantity', times: 1 } },
    });
  });

  it('runs extraction mid-flow even for a bare answer', async () => {
    llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
    llm.extraction = ok({ ...NOTHING, quantity: 2 }, 'extract');
    const { convo, job } = await thread(t.merchantA, {
      state: 'collecting_details',
      collectedSlots: { productText: 'red saree', lastAsked: { slot: 'quantity', times: 1 } },
    });

    await service().run(job);

    expect(llm.calls).toEqual(['classify', 'extract', 'phrase']);
    expect((await conversationRow(convo.id))?.collectedSlots).toMatchObject({ quantity: 2 });
  });

  it('does nothing for a conversation on a Page the shop no longer has', async () => {
    const { job } = await thread(t.merchantA, { facebookPageId: 'old-page' });
    await expect(service().run(job)).resolves.toBe('no_page');
    expect(llm.calls).toEqual([]);
  });
  it('refuses to reply once the 24-hour window has closed, recording only the calls', async () => {
    const { convo, job } = await thread(t.merchantA, {
      lastInboundAt: new Date(Date.now() - 25 * 3_600_000),
    });

    await expect(service().run(job)).resolves.toBe('window_closed');

    expect(sent).toEqual([]);
    expect((await messagesOf(convo.id)).filter((m) => m.sender === 'assistant')).toEqual([]);
    expect(await llmCallsOf(convo.id)).toHaveLength(2);
  });

  it('hands off a complaint with the fixed reply and notifies with the stored timestamp', async () => {
    llm.intent = ok({ intent: 'complain', confidence: 0.9 }, 'classify');
    const { convo, job } = await thread();

    await expect(service().run(job)).resolves.toBe('handed_off');

    expect(sent).toHaveLength(1);
    const row = await conversationRow(convo.id);
    expect(row).toMatchObject({ state: 'handed_off' });
    expect(row?.handedOffAt).toBeInstanceOf(Date);
    expect(handoffs).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, at: row?.handedOffAt },
    ]);
  });

  it('writes nothing but the calls when a newer message lands during the LLM call', async () => {
    const { convo, job } = await thread();
    llm.onClassify = async () => {
      await seedMessage(t.db, t.merchantA, convo.id, { sentAt: new Date(), text: 'red saree' });
    };

    await expect(service().run(job)).resolves.toBe('stale');

    expect(sent).toEqual([]);
    expect((await messagesOf(convo.id)).filter((m) => m.sender === 'assistant')).toEqual([]);
    expect(await llmCallsOf(convo.id)).toHaveLength(2);
  });

  it('resumes a hand-off whose notification failed: notifies again, sends nothing', async () => {
    llm.intent = ok({ intent: 'complain', confidence: 0.9 }, 'classify');
    const { convo, job } = await thread();
    notifyFailures = 1;

    await expect(service().run(job)).rejects.toThrow('queue down');
    expect(sent).toHaveLength(1);
    expect(handoffs).toEqual([]);
    llm.calls = [];

    await expect(service().run(job)).resolves.toBe('handed_off');

    const row = await conversationRow(convo.id);
    expect(handoffs).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, at: row?.handedOffAt },
    ]);
    expect(sent).toHaveLength(1);
    expect(llm.calls).toEqual([]);
  });

  it('resumes a failed send that never reached the hand-off', async () => {
    const { convo, job, trigger } = await thread();
    await seedMessage(t.db, t.merchantA, convo.id, {
      sender: 'assistant',
      status: 'failed',
      sentAt: new Date(trigger.sentAt.getTime() + 10),
      text: 'Which product would you like?',
    });

    await expect(service().run(job)).resolves.toBe('send_failed');

    const row = await conversationRow(convo.id);
    expect(row?.state).toBe('handed_off');
    expect(handoffs).toEqual([
      { merchantId: t.merchantA, conversationId: convo.id, at: row?.handedOffAt },
    ]);
    expect(sent).toEqual([]);
    expect(llm.calls).toEqual([]);
  });

  it('does not hand off a failed send on a chat the seller has since paused', async () => {
    const { convo, job, trigger } = await thread(t.merchantA, { botPaused: true });
    await seedMessage(t.db, t.merchantA, convo.id, {
      sender: 'assistant',
      status: 'failed',
      sentAt: new Date(trigger.sentAt.getTime() + 10),
    });

    await expect(service().run(job)).resolves.toBe('paused');
    expect(handoffs).toEqual([]);
  });

  it('orders the reply after a trigger stamped ahead of our clock, and a retry sends nothing twice', async () => {
    const { convo, job, trigger } = await thread(t.merchantA, {}, new Date(Date.now() + 5_000));

    await expect(service().run(job)).resolves.toBe('replied');

    const reply = (await messagesOf(convo.id)).find((m) => m.sender === 'assistant');
    expect(reply?.sentAt.getTime()).toBeGreaterThan(trigger.sentAt.getTime());
    await expect(service().run(job)).resolves.toBe('answered');
    expect(sent).toHaveLength(1);
  });
});
