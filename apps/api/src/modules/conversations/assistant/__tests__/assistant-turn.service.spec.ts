import { Logger } from '@nestjs/common';
import { emptySlots, type ExtractedOrder, type IntentResult } from '@app/shared';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedCategory,
  seedImage,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import {
  seedConversation,
  seedCustomer,
  seedFacebookPage,
  seedMessage,
} from '../../../database/__tests__/conversation-seeds';
import type {
  ChatLine,
  ExtractionContext,
  LlmClient,
  LlmPurpose,
  LlmResult,
} from '../../../llm/llm.types';
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import {
  GraphError,
  type GraphOption,
  type MetaGraphClient,
} from '../../../messenger/page/meta-graph.client';
import type { NotificationsService } from '../../../notifications/notifications.service';
import { seedOrder } from '../../../database/__tests__/order-seeds';
import { OrdersRepository } from '../../../orders/orders.repository';
import { productsService } from '../../../products/__tests__/products-service.fixture';
import { DeliveryChargesRepository } from '../../../settings/delivery-charges.repository';
import { MerchantSettingsRepository } from '../../../settings/merchant-settings.repository';
import { ConversationRepository } from '../../conversation.repository';
import { ConversationsService } from '../../conversations.service';
import type { ConversationEventsPublisher } from '../../events/conversation-events.publisher';
import { MessageRepository } from '../../message.repository';
import { OutboundMessageSender } from '../../outbound-message.sender';
import { fallbackText, REFERRAL_TEXT } from '../assistant-fallbacks';
import { AssistantTurnService, extractionContext } from '../assistant-turn.service';
import { LlmCallRepository } from '../llm-call.repository';
import { EVAL_CATALOG, productByKey } from './fixtures/match-eval';
import type { CardTap, OrderConfirmationService } from '../order-confirmation.service';

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
  items: null,
  customerName: null,
  phone: null,
  deliveryAddress: null,
  deliveryArea: null,
  confidence: 0.9,
};
let nextMid = 1;

class FakeLlm implements LlmClient {
  intent: LlmResult<IntentResult> = ok({ intent: 'browse', confidence: 0.9 }, 'classify');
  extraction: LlmResult<ExtractedOrder> = ok(NOTHING, 'extract');
  phrase: LlmResult<string> = ok('Which product would you like?', 'phrase');
  calls: LlmPurpose[] = [];
  extractContexts: ExtractionContext[] = [];
  onClassify: () => Promise<void> = async () => undefined;
  async classifyIntent() {
    this.calls.push('classify');
    await this.onClassify();
    return this.intent;
  }
  async extractOrder(_history: ChatLine[], context: ExtractionContext) {
    this.extractContexts.push(context);
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
  let rich: {
    kind: 'image' | 'quick_replies' | 'card' | 'carousel' | 'text';
    text: string;
    payloads: string[];
  }[];
  let graphFails: boolean;
  let notifyFailures: number;
  let handoffs: { merchantId: string; conversationId: string; at: Date }[];
  let cardTaps: CardTap[];

  const send = (
    kind: (typeof rich)[number]['kind'],
    psid: string,
    text: string,
    options: GraphOption[] = [],
  ) => {
    if (graphFails) throw new GraphError(400, 10, 'outside window');
    rich.push({ kind, text, payloads: options.map((option) => option.payload) });
    if (kind !== 'image') sent.push({ psid, text });
    return Promise.resolve({ messageId: `mid-turn-${nextMid++}` });
  };
  const graph = {
    sendText: (_token: string, psid: string, text: string) => send('text', psid, text),
    sendQuickReplies: (_token: string, psid: string, text: string, options: GraphOption[]) =>
      send('quick_replies', psid, text, options),
    sendButtonTemplate: (_token: string, psid: string, text: string, buttons: GraphOption[]) =>
      send('card', psid, text, buttons),
    sendImage: (_token: string, psid: string, url: string) => send('image', psid, url),
    sendGenericTemplate: (_token: string, psid: string, cards: { title: string }[]) =>
      send('carousel', psid, cards.map((card) => card.title).join(', ')),
  } as unknown as MetaGraphClient;

  const service = (client: LlmClient | null = llm) => {
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    return new AssistantTurnService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      new MerchantSettingsRepository(),
      new DeliveryChargesRepository(),
      productsService(runtime.db),
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
      {
        run: async (_job: unknown, tap: CardTap) => {
          cardTaps.push(tap);
          return 'ordered';
        },
      } as unknown as OrderConfirmationService,
      new OrdersRepository(),
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
    rich = [];
    cardTaps = [];
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
      collectedSlots: { items: [], lastAsked: { slot: 'product', item: 0, times: 1 } },
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
        { kind: 'ask_slot', slot: 'product', item: 0, intent: 'browse', facts: { items: [] } },
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
        { kind: 'ask_slot', slot: 'product', item: 0, intent: 'browse', facts: { items: [] } },
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
        { kind: 'ask_slot', slot: 'product', item: 0, intent: 'browse', facts: { items: [] } },
        'en',
      ),
    ]);
  });

  it('reads unreadable slots as empty', async () => {
    const { convo, job } = await thread(t.merchantA, { collectedSlots: { items: 'two' } });

    await expect(service().run(job)).resolves.toBe('replied');

    expect((await conversationRow(convo.id))?.collectedSlots).toEqual({
      items: [],
      revision: 0,
      lastAsked: { slot: 'product', item: 0, times: 1 },
    });
  });

  it('starts the repeat count afresh after the seller hands the chat back', async () => {
    llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
    const { convo, job } = await thread(t.merchantA, {
      state: 'handed_off',
      botPaused: true,
      collectedSlots: {
        items: [{ productQuery: 'red saree' }],
        lastAsked: { slot: 'product', item: 0, times: 2 },
      },
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
      collectedSlots: {
        items: [{ productQuery: 'red saree' }],
        lastAsked: { slot: 'product', item: 0, times: 1 },
      },
    });
  });

  it('runs extraction mid-flow even for a bare answer', async () => {
    llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
    llm.extraction = ok({ ...NOTHING, customerName: 'Rahim' }, 'extract');
    const { convo, job } = await thread(t.merchantA, {
      state: 'collecting_details',
      collectedSlots: {
        items: [{ productQuery: 'red saree' }],
        lastAsked: { slot: 'product', item: 0, times: 1 },
      },
    });

    await service().run(job);

    expect(llm.calls).toEqual(['classify', 'extract', 'phrase']);
    expect((await conversationRow(convo.id))?.collectedSlots).toMatchObject({
      customerName: 'Rahim',
    });
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

  it('hands a Confirm or Change tap to the Confirm path with no LLM call, even once confirmed', async () => {
    const { convo, job } = await thread(t.merchantA, { state: 'confirmed' });
    const tap = await seedMessage(t.db, t.merchantA, convo.id, {
      sentAt: new Date(),
      text: 'Confirm',
      payload: `confirm:${convo.id}:3`,
    });

    await expect(service().run({ ...job, triggerMessageId: tap.id })).resolves.toBe('ordered');

    expect(cardTaps).toEqual([{ kind: 'confirm', conversationId: convo.id, revision: 3 }]);
    expect(llm.calls).toEqual([]);
  });

  describe('with a catalog', () => {
    const item = (productQuery: string, quantity: number | null = null) => ({
      ref: null,
      productQuery,
      productQueryAlt: null,
      variantQuery: null,
      variantQueryAlt: null,
      quantity,
    });
    const product = async (name: string, price = 160_000) => {
      const row = await seedProduct(t.db, t.merchantA, { name, status: 'active' });
      const variant = await seedVariant(t.db, t.merchantA, row.id, {
        name: null,
        isDefault: true,
        price,
        stock: 5,
      });
      return { product: row, variant };
    };
    const tapped = async (convoId: string, payload: string) =>
      seedMessage(t.db, t.merchantA, convoId, { sentAt: new Date(), text: 'tap', payload });

    it("sends the matched product's cover before asking how many", async () => {
      const { product: lungi } = await product('Turnservice Lungi');
      const cover = await seedImage(t.db, t.merchantA, lungi.id);
      await t.db
        .update(schema.product)
        .set({ coverImageId: cover.id })
        .where(eq(schema.product.id, lungi.id));
      llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
      llm.extraction = ok({ ...NOTHING, items: [item('turnservice lungi')] }, 'extract');
      const { convo, job } = await thread();

      await expect(service().run(job)).resolves.toBe('replied');

      expect(rich.map((entry) => entry.kind)).toEqual(['image', 'text']);
      expect(rich[0]?.text).toMatch(/^https?:\/\//);
      expect((await conversationRow(convo.id))?.collectedSlots).toMatchObject({
        items: [{ productId: lungi.id }],
        lastAsked: { slot: 'quantity', item: 0 },
      });
    });

    it('offers close candidates as quick replies, and a tap fills the item with no LLM call', async () => {
      const { product: red } = await product('Turnservice Saree Red');
      const { product: blue } = await product('Turnservice Saree Blue');
      llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
      llm.extraction = ok({ ...NOTHING, items: [item('turnservice saree', 1)] }, 'extract');
      const { convo, job } = await thread();

      await service().run(job);

      const offer = rich.find((entry) => entry.kind === 'quick_replies');
      expect(offer?.payloads).toEqual(
        expect.arrayContaining([`pick:product:${red.id}`, `pick:product:${blue.id}`]),
      );

      llm.calls = [];
      const tap = await tapped(convo.id, `pick:product:${blue.id}`);
      await expect(service().run({ ...job, triggerMessageId: tap.id })).resolves.toBe('replied');

      expect(llm.calls).toEqual([]);
      const slots = (await conversationRow(convo.id))?.collectedSlots;
      expect(slots).toMatchObject({ items: [{ productId: blue.id, quantity: 1 }] });
      expect(slots).not.toHaveProperty('offered');
    });

    it('reads a tap on a candidate that was never offered as an ordinary message', async () => {
      const { product: other } = await product('Turnservice Kajal');
      const { convo, job } = await thread();
      const tap = await tapped(convo.id, `pick:product:${other.id}`);

      await service().run({ ...job, triggerMessageId: tap.id });

      expect(llm.calls).toContain('classify');
      expect((await conversationRow(convo.id))?.collectedSlots).toMatchObject({ items: [] });
    });

    describe('entry triggers', () => {
      /** A tap row after the thread's first message, with the text Meta or the ingest stored. */
      const entryTap = async (text: string, payload: string) => {
        const made = await thread();
        const tap = await seedMessage(t.db, t.merchantA, made.convo.id, {
          sentAt: new Date(),
          text,
          payload,
        });
        return { ...made, job: { ...made.job, triggerMessageId: tap.id } };
      };
      /** Two live categories with a sellable product each, so browsing offers a choice. */
      const twoCategories = async () => {
        for (const name of ['Turnservice Sarees', 'Turnservice Kurtis']) {
          const category = await seedCategory(t.db, t.merchantA, { name });
          const { product: row } = await product(`${name} item`);
          await t.db
            .insert(schema.productCategory)
            .values({ merchantId: t.merchantA, productId: row.id, categoryId: category.id });
        }
      };
      const slotsOf = async (id: string) => (await conversationRow(id))?.collectedSlots;

      it('answers Get Started with the categories and never calls the LLM', async () => {
        await twoCategories();
        const { job } = await entryTap('Get Started', 'start');

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(rich.map((entry) => entry.kind)).toEqual(['quick_replies']);
      });

      it('answers a ref to an archived product with categories and collects nothing', async () => {
        const archived = await seedProduct(t.db, t.merchantA, {
          name: 'Turnservice Old saree',
          status: 'archived',
        });
        const { convo, job } = await entryTap(REFERRAL_TEXT.bn.link, `ref:product:${archived.id}`);

        await service().run(job);

        expect(llm.calls).toEqual([]);
        expect(rich[0]?.kind).toBe('quick_replies');
        expect(await slotsOf(convo.id)).toMatchObject({ items: [] });
      });

      it('collects the product of a link opened on its own, and asks for its variant', async () => {
        const jamdani = await seedProduct(t.db, t.merchantA, {
          name: 'Turnservice Jamdani',
          status: 'active',
        });
        for (const name of ['Red', 'Blue']) {
          await seedVariant(t.db, t.merchantA, jamdani.id, { name, price: 450_000, stock: 5 });
        }
        const { convo, job } = await entryTap(REFERRAL_TEXT.bn.link, `ref:product:${jamdani.id}`);

        await service().run(job);

        expect(llm.calls).toEqual([]);
        expect(await slotsOf(convo.id)).toMatchObject({ items: [{ productId: jamdani.id }] });
        expect(rich.at(-1)?.kind).toBe('quick_replies');
      });

      it('runs the LLM on a ref that came with typed text, the item already collected', async () => {
        const { product: saree } = await product('Turnservice Typed Saree');
        llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
        const { job } = await entryTap('how much is this?', `ref:product:${saree.id}`);

        await service().run(job);

        expect(llm.calls).toContain('classify');
        expect(llm.extractContexts.at(-1)?.items).toEqual([
          expect.objectContaining({ product: 'Turnservice Typed Saree' }),
        ]);
      });

      it('answers My last order with the newest order', async () => {
        const { customer, job } = await entryTap('My last order', 'menu:last-order');
        await seedOrder(t.db, t.merchantA, customer.id, {
          reference: 'ORD-2026-00481',
          status: 'packed',
          placedAt: new Date(Date.now() - 1_000),
        });
        await seedOrder(t.db, t.merchantA, customer.id, {
          reference: 'ORD-2025-00001',
          placedAt: new Date(Date.now() - 86_400_000),
        });

        await service().run(job);

        expect(llm.calls).toEqual([]);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.text).toContain('ORD-2026-00481');
      });

      it('hands off on the human menu item without the LLM', async () => {
        const { job } = await entryTap('Talk to a person', 'menu:human');

        await expect(service().run(job)).resolves.toBe('handed_off');

        expect(llm.calls).toEqual([]);
      });
    });

    it('sends the summary as a card whose buttons carry its revision, never phrased', async () => {
      const { product: hijab, variant } = await product('Turnservice Hijab', 50_000);
      await t.db.insert(schema.deliveryCharge).values({
        merchantId: t.merchantA,
        areaName: null,
        isFallback: true,
        charge: 12_000,
        position: 0,
      });
      llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
      const { convo, job } = await thread(t.merchantA, {
        state: 'collecting_details',
        collectedSlots: {
          items: [
            { productQuery: 'hijab', productId: hijab.id, variantId: variant.id, quantity: 2 },
          ],
          customerName: 'Rahim',
          phone: '+8801812000000',
          deliveryAddress: 'Zindabazar, Sylhet',
          revision: 3,
        },
      });

      await expect(service().run(job)).resolves.toBe('replied');

      expect(llm.calls).toEqual(['classify', 'extract']);
      const card = rich.find((entry) => entry.kind === 'card');
      expect(card?.payloads).toEqual([`confirm:${convo.id}:4`, `change:${convo.id}:4`]);
      expect(card?.text).toContain('Turnservice Hijab');
      expect(await conversationRow(convo.id)).toMatchObject({
        state: 'awaiting_confirmation',
        collectedSlots: {
          revision: 4,
          quote: { revision: 4, subtotal: 100_000, deliveryFee: 12_000, total: 112_000 },
        },
      });
    });
  });
});

describe('extractionContext', () => {
  it("shows the customer's words beside the catalog names of a matched item", () => {
    const katan = productByKey('katan');
    const red = katan.variants.find((variant) => variant.name === 'Red')!;
    const context = extractionContext(
      {
        ...emptySlots(),
        items: [
          { productQuery: 'saree', productId: katan.id, variantQuery: 'lal', variantId: red.id },
          { productQuery: 'kajol', quantity: 2 },
        ],
      },
      EVAL_CATALOG,
    );
    expect(context.items).toEqual([
      {
        ref: 0,
        product: 'Katan Silk Saree',
        customerWords: 'saree',
        variant: 'Red',
        customerVariantWords: 'lal',
      },
      { ref: 1, product: 'kajol', customerWords: 'kajol', quantity: 2 },
    ]);
  });
});
