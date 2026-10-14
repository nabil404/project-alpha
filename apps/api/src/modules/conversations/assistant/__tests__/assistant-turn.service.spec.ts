import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { emptySlots, MAX_ORDER_ITEMS, type ExtractedOrder, type IntentResult } from '@app/shared';
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
import { ProductPostRepository } from '../../../messenger/posts/product-post.repository';
import type { SharedLink } from '../../../queue/queue.constants';
import { SharedPostResolver } from '../../../messenger/posts/shared-post.resolver';
import {
  GraphError,
  type GraphOption,
  type GraphPost,
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
  histories: ChatLine[][] = [];
  async classifyIntent(history: ChatLine[]) {
    this.histories.push(history);
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
  /** Posts Graph can read, by Graph id; any other read fails as a missing permission. */
  const graphPosts = new Map<string, GraphPost>();

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
    getPost: (_token: string, id: string) => {
      const post = graphPosts.get(id);
      return post
        ? Promise.resolve(post)
        : Promise.reject(new GraphError(403, 10, 'no permission'));
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
      new SharedPostResolver(runtime.db, new ProductPostRepository(), crypto, graph, () =>
        Promise.reject(new Error('no short links in this spec')),
      ),
      new ProductPostRepository(),
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

    describe('the profile name', () => {
      /** A thread whose one item is complete, so the name is asked for next. */
      const nameNext = async (profileName: string | null, psid?: string) => {
        const { product: row, variant } = await product('Turnservice Gamcha');
        const made = await thread(t.merchantA, {
          state: 'collecting_details',
          collectedSlots: {
            items: [{ productId: row.id, variantId: variant.id, quantity: 1 }],
            revision: 0,
          },
        });
        await t.db
          .update(schema.customer)
          .set({ name: profileName, ...(psid ? { psid } : {}) })
          .where(eq(schema.customer.id, made.customer.id));
        llm.intent = ok({ intent: 'other', confidence: 0.9 }, 'classify');
        return made;
      };

      it('offers it as a quick reply, and a tap fills the name with no LLM call', async () => {
        const { convo, job } = await nameNext('Nusrat Jahan');

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual(['classify', 'extract']);
        const offer = rich.at(-1);
        expect(offer).toMatchObject({ kind: 'quick_replies', payloads: ['name:profile'] });
        expect(offer?.text).toBe('অর্ডারটি কি Nusrat Jahan নামে হবে? না হলে নামটি লিখে দিন।');
        expect((await conversationRow(convo.id))?.collectedSlots).toMatchObject({
          offeredName: 'Nusrat Jahan',
          lastAsked: { slot: 'customerName', times: 1 },
        });
        expect((await conversationRow(convo.id))?.collectedSlots).not.toHaveProperty(
          'customerName',
        );

        llm.calls = [];
        const tap = await tapped(convo.id, 'name:profile');
        await expect(service().run({ ...job, triggerMessageId: tap.id })).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        const slots = (await conversationRow(convo.id))?.collectedSlots;
        expect(slots).toMatchObject({
          customerName: 'Nusrat Jahan',
          lastAsked: { slot: 'phone', times: 1 },
        });
        expect(slots).not.toHaveProperty('offeredName');
        expect(rich.at(-1)?.kind).toBe('text');
      });

      it('reads a typed name instead of the offer', async () => {
        const { convo, job } = await nameNext('Nusrat Jahan');
        await service().run(job);

        llm.extraction = ok({ ...NOTHING, customerName: 'Nusrat Begum' }, 'extract');
        const typed = await seedMessage(t.db, t.merchantA, convo.id, {
          sentAt: new Date(),
          text: 'Nusrat Begum',
        });
        await service().run({ ...job, triggerMessageId: typed.id });

        const slots = (await conversationRow(convo.id))?.collectedSlots;
        expect(slots).toMatchObject({ customerName: 'Nusrat Begum' });
        expect(slots).not.toHaveProperty('offeredName');
      });

      it('shows extraction the offer, so a typed yes fills the name', async () => {
        const { convo, job } = await nameNext('Nusrat Jahan');
        await service().run(job);

        llm.extraction = ok({ ...NOTHING, customerName: 'Nusrat Jahan' }, 'extract');
        const typed = await seedMessage(t.db, t.merchantA, convo.id, {
          sentAt: new Date(),
          text: 'হ্যাঁ',
        });
        await service().run({ ...job, triggerMessageId: typed.id });

        expect(llm.extractContexts.at(-1)).toMatchObject({ offeredName: 'Nusrat Jahan' });
        const slots = (await conversationRow(convo.id))?.collectedSlots;
        expect(slots).toMatchObject({ customerName: 'Nusrat Jahan' });
        expect(slots).not.toHaveProperty('offeredName');
      });

      it('asks as before, phrased, when Facebook shared no name', async () => {
        const { convo, job } = await nameNext(null);

        await service().run(job);

        expect(llm.calls).toEqual(['classify', 'extract', 'phrase']);
        expect(llm.extractContexts.at(-1)).not.toHaveProperty('offeredName');
        expect(rich.at(-1)?.kind).toBe('text');
        expect((await conversationRow(convo.id))?.collectedSlots).not.toHaveProperty('offeredName');
      });

      it('reads a name tap with nothing offered as an ordinary message', async () => {
        const { convo, job } = await nameNext('Nusrat Jahan');
        const tap = await tapped(convo.id, 'name:profile');

        await service().run({ ...job, triggerMessageId: tap.id });

        expect(llm.calls).toContain('classify');
        expect((await conversationRow(convo.id))?.collectedSlots).not.toHaveProperty(
          'customerName',
        );
      });

      it("never offers another merchant's customer's name", async () => {
        const psid = `psid-shared-${Date.now()}`;
        await seedCustomer(t.db, t.merchantB, { psid, name: 'Shop B Customer' });
        const { convo, job } = await nameNext(null, psid);

        await service().run(job);

        expect(rich.at(-1)?.payloads).toEqual([]);
        expect(sent.at(-1)?.text).not.toContain('Shop B Customer');
        expect((await conversationRow(convo.id))?.collectedSlots).not.toHaveProperty('offeredName');
      });
    });

    describe('shared posts', () => {
      /** A conversation the assistant has answered, then a share: the burst is the share alone. */
      const share = async (links: SharedLink[], words: string | null = null) => {
        const made = await thread();
        await seedMessage(t.db, t.merchantA, made.convo.id, {
          sender: 'assistant',
          sentAt: new Date(Date.now() - 800),
          text: 'Hello!',
        });
        const shared = await seedMessage(t.db, t.merchantA, made.convo.id, {
          sentAt: new Date(Date.now() - 500),
          kind: 'share',
          text: '',
          details: { links },
        });
        const trigger = words
          ? await seedMessage(t.db, t.merchantA, made.convo.id, { sentAt: new Date(), text: words })
          : shared;
        return { ...made, job: { ...made.job, triggerMessageId: trigger.id } };
      };
      const postId = () => String(Math.floor(Math.random() * 1e14));
      const twoColours = async (name: string) => {
        const row = await seedProduct(t.db, t.merchantA, { name, status: 'active' });
        for (const colour of ['Red', 'Blue']) {
          await seedVariant(t.db, t.merchantA, row.id, { name: colour, price: 450_000, stock: 5 });
        }
        return row;
      };
      const postsOf = (productId: string) =>
        t.db.select().from(schema.productPost).where(eq(schema.productPost.productId, productId));
      const slotsOf = async (id: string) => (await conversationRow(id))?.collectedSlots;

      it('resolves a linked post with no LLM call and asks for its variant', async () => {
        const jamdani = await twoColours('Turnservice Linked Jamdani');
        const id = postId();
        await t.db.insert(schema.productPost).values({
          merchantId: t.merchantA,
          productId: jamdani.id,
          postId: id,
          status: 'linked',
        });
        const { convo, job } = await share([
          { url: null, title: 'New Jamdani', postId: `${pageA}_${id}` },
        ]);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(rich.at(-1)?.kind).toBe('quick_replies');
        expect(await slotsOf(convo.id)).toMatchObject({
          items: [{ productId: jamdani.id }],
          lastAsked: { slot: 'variant', item: 0 },
        });
      });

      it('resolves a pfbid-only share of a post linked by its number, through Graph', async () => {
        // The shape Messenger sent on the dev Page (Oct 14, 2026): only a pfbid
        // permalink, while the seller linked the post's numeric link.
        const jamdani = await twoColours('Turnservice Numeric Jamdani');
        const number = postId();
        const pfbid = `pfbid02${randomUUID().replaceAll('-', '')}`;
        await t.db.insert(schema.productPost).values({
          merchantId: t.merchantA,
          productId: jamdani.id,
          postId: number,
          url: `https://www.facebook.com/122110277373500449/posts/${number}`,
          status: 'linked',
        });
        graphPosts.set(`${pageA}_${pfbid}`, {
          id: `${pageA}_${number}`,
          message: 'This is a test post',
          permalinkUrl: `https://www.facebook.com/122110277373500449/posts/${number}`,
          pictureUrl: null,
          createdTime: null,
        });
        const shared = `https://www.facebook.com/permalink.php?story_fbid=${pfbid}&id=61595013491325`;
        const { convo, job } = await share([{ url: shared, title: null, postId: null }]);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(await slotsOf(convo.id)).toMatchObject({
          items: [{ productId: jamdani.id }],
          lastAsked: { slot: 'variant', item: 0 },
        });
        // The pfbid is kept, so the next share matches without Graph.
        expect(await postsOf(jamdani.id)).toEqual([
          expect.objectContaining({ postId: number, aliasId: pfbid, status: 'linked' }),
        ]);
        graphPosts.delete(`${pageA}_${pfbid}`);
        const again = await share([{ url: shared, title: null, postId: null }]);
        await service().run(again.job);
        expect(await slotsOf(again.convo.id)).toMatchObject({ items: [{ productId: jamdani.id }] });
      });

      it('matches a linked post by the pfbid id of its link', async () => {
        const jamdani = await twoColours('Turnservice Pfbid Jamdani');
        const pfbid = `pfbid0${randomUUID().replaceAll('-', '')}`;
        await t.db.insert(schema.productPost).values({
          merchantId: t.merchantA,
          productId: jamdani.id,
          postId: postId(),
          aliasId: pfbid,
          status: 'linked',
        });
        const { convo, job } = await share([
          { url: `https://www.facebook.com/shop/posts/${pfbid}`, title: null, postId: null },
        ]);

        await service().run(job);

        expect(llm.calls).toEqual([]);
        expect(await slotsOf(convo.id)).toMatchObject({ items: [{ productId: jamdani.id }] });
      });

      it('runs the LLM on words sent with a linked post, the item already collected', async () => {
        const jamdani = await twoColours('Turnservice Typed Linked Jamdani');
        const id = postId();
        await t.db.insert(schema.productPost).values({
          merchantId: t.merchantA,
          productId: jamdani.id,
          postId: id,
          status: 'linked',
        });
        llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
        const { job } = await share(
          [{ url: null, title: null, postId: `${pageA}_${id}` }],
          'how much is this?',
        );

        await service().run(job);

        expect(llm.calls).toContain('classify');
        expect(llm.extractContexts.at(-1)?.items).toEqual([
          expect.objectContaining({ product: 'Turnservice Typed Linked Jamdani' }),
        ]);
      });

      it('reads an unlinked post by its caption, asks to confirm, and stores a suggestion', async () => {
        const katan = await twoColours('Turnservice Caption Katan');
        const id = postId();
        graphPosts.set(`${pageA}_${id}`, {
          id: `${pageA}_${id}`,
          message: 'New stock! Turnservice Caption Katan in two colours, order now',
          permalinkUrl: `https://www.facebook.com/shop/posts/${id}`,
          pictureUrl: null,
          createdTime: null,
        });
        const { convo, job } = await share([{ url: null, title: null, postId: id }]);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        const ask = rich.at(-1);
        expect(ask?.kind).toBe('quick_replies');
        expect(ask?.payloads).toEqual([`pick:product:${katan.id}`]);
        expect(sent.at(-1)?.text).toContain('Turnservice Caption Katan');
        // Nothing is filled until the customer confirms.
        expect(await slotsOf(convo.id)).toMatchObject({
          items: [],
          offered: { slot: 'product', item: 0, ids: [katan.id] },
        });
        expect(await postsOf(katan.id)).toEqual([
          expect.objectContaining({ postId: id, status: 'suggested', caption: expect.any(String) }),
        ]);

        const tap = await seedMessage(t.db, t.merchantA, convo.id, {
          sentAt: new Date(),
          text: 'Turnservice Caption Katan',
          payload: `pick:product:${katan.id}`,
        });
        await service().run({ ...job, triggerMessageId: tap.id });

        expect(llm.calls).toEqual([]);
        expect(await slotsOf(convo.id)).toMatchObject({
          items: [{ productId: katan.id }],
          lastAsked: { slot: 'variant', item: 0 },
        });
      });

      it('asks which product when the post cannot be read, and hands off at the next ask', async () => {
        const { convo, job } = await share([
          { url: 'https://www.facebook.com/shop/posts/hello', title: null, postId: postId() },
        ]);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(rich.at(-1)?.kind).toBe('text');
        const slots = await slotsOf(convo.id);
        expect(slots).toMatchObject({
          items: [],
          lastAsked: { slot: 'product', item: 0, times: 2 },
        });
        expect(slots).not.toHaveProperty('offered');

        // The customer still names nothing the shop sells.
        llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
        llm.extraction = ok({ ...NOTHING, items: [item('something else entirely')] }, 'extract');
        const reply = await seedMessage(t.db, t.merchantA, convo.id, {
          sentAt: new Date(),
          text: 'the nice one',
        });
        await expect(service().run({ ...job, triggerMessageId: reply.id })).resolves.toBe(
          'handed_off',
        );
      });
    });

    describe('entry triggers', () => {
      /** A tap row after the thread's first message, with the text Meta or the ingest stored. */
      const entryTap = async (
        text: string,
        payload: string,
        overrides: Partial<typeof schema.conversation.$inferInsert> = {},
      ) => {
        const made = await thread(t.merchantA, overrides);
        const tap = await seedMessage(t.db, t.merchantA, made.convo.id, {
          sentAt: new Date(),
          text,
          payload,
        });
        return { ...made, job: { ...made.job, triggerMessageId: tap.id } };
      };
      /** Two live categories with a sellable product each, so browsing offers a choice. Seeded once. */
      let categoriesSeeded = false;
      const twoCategories = async () => {
        if (categoriesSeeded) return;
        categoriesSeeded = true;
        for (const name of ['Turnservice Sarees', 'Turnservice Kurtis']) {
          const category = await seedCategory(t.db, t.merchantA, { name });
          const { product: row } = await product(`${name} item`);
          await t.db
            .insert(schema.productCategory)
            .values({ merchantId: t.merchantA, productId: row.id, categoryId: category.id });
        }
      };
      const slotsOf = async (id: string) => (await conversationRow(id))?.collectedSlots;
      const withCover = async (productId: string) => {
        const cover = await seedImage(t.db, t.merchantA, productId);
        await t.db
          .update(schema.product)
          .set({ coverImageId: cover.id })
          .where(eq(schema.product.id, productId));
      };
      /** Slots already holding the most items an order may have. */
      const fullOrder = () => ({
        items: Array.from({ length: MAX_ORDER_ITEMS }, (_, index) => ({
          productQuery: `item ${index}`,
        })),
      });

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

      it('answers Get Started that carried a link with the product, never the LLM', async () => {
        const jamdani = await seedProduct(t.db, t.merchantA, {
          name: 'Turnservice Started Jamdani',
          status: 'active',
        });
        for (const name of ['Red', 'Blue']) {
          await seedVariant(t.db, t.merchantA, jamdani.id, { name, price: 450_000, stock: 5 });
        }
        await withCover(jamdani.id);
        const { convo, job } = await entryTap('Get Started', `ref:product:${jamdani.id}`);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(rich.map((entry) => entry.kind)).toEqual(['image', 'quick_replies']);
        expect(await slotsOf(convo.id)).toMatchObject({
          items: [{ productId: jamdani.id }],
          lastAsked: { slot: 'variant', item: 0 },
        });
      });

      it('answers an unmapped ad opened on its own with the categories, never the LLM', async () => {
        await twoCategories();
        const { job } = await entryTap(REFERRAL_TEXT.bn.ad, 'browse');

        await expect(service().run(job)).resolves.toBe('replied');

        expect(llm.calls).toEqual([]);
        expect(rich.map((entry) => entry.kind)).toEqual(['quick_replies']);
      });

      it('runs the LLM on a ref that came with typed text, the item already collected', async () => {
        const { product: saree } = await product('Turnservice Typed Saree');
        llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
        const { job } = await entryTap('how much is this?', `ref-typed:product:${saree.id}`);

        await service().run(job);

        expect(llm.calls).toContain('classify');
        expect(llm.extractContexts.at(-1)?.items).toEqual([
          expect.objectContaining({ product: 'Turnservice Typed Saree' }),
        ]);
      });

      it("sends the typed ref's product photo before the reply", async () => {
        const { product: saree } = await product('Turnservice Typed Photo Saree');
        await withCover(saree.id);
        llm.intent = ok({ intent: 'order', confidence: 0.9 }, 'classify');
        const { job } = await entryTap('how much is this?', `ref-typed:product:${saree.id}`);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(rich[0]?.kind).toBe('image');
        expect(rich[0]?.text).toMatch(/^https?:\/\//);
      });

      it('hands off a typed ref with no room for another item, without the LLM', async () => {
        const { product: saree } = await product('Turnservice Full Saree');
        const { convo, job } = await entryTap('and this one', `ref-typed:product:${saree.id}`, {
          state: 'collecting_details',
          collectedSlots: fullOrder(),
        });

        await expect(service().run(job)).resolves.toBe('handed_off');

        expect(llm.calls).toEqual([]);
        expect(rich.some((entry) => entry.kind === 'image')).toBe(false);
        // Arrays match whole under toMatchObject: nothing was added.
        expect(await slotsOf(convo.id)).toMatchObject({ items: fullOrder().items });
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
  describe('messages without words', () => {
    const USE_CONFIRM = fallbackText({ kind: 'notice', notice: 'use_confirm' }, 'bn');
    const LIKE = { attachments: [{ url: null, stickerId: '369239263222822' }] };
    /** Every non-text event a customer can send on the summary card. */
    const EVENTS: { name: string; values: Partial<typeof schema.message.$inferInsert> }[] = [
      { name: 'the 👍 sticker', values: { kind: 'sticker', text: '👍', details: LIKE } },
      {
        name: 'an "ok" sticker',
        values: { kind: 'sticker', text: '', details: { attachments: [] } },
      },
      {
        name: 'a ❤️ reaction on the card',
        values: {
          kind: 'reaction',
          text: '❤️',
          details: {
            reaction: { emoji: '❤️', label: 'love', targetMid: 'mid-card', targetMessageId: null },
          },
        },
      },
      { name: 'a 👍 typed', values: { kind: 'text', text: '👍' } },
      {
        name: 'a location',
        values: {
          kind: 'location',
          text: '',
          details: { location: { lat: 23.8, long: 90.4 } },
        },
      },
      { name: 'a photo', values: { kind: 'image', text: '' } },
      { name: 'a video', values: { kind: 'video', text: '' } },
      { name: 'a file', values: { kind: 'file', text: '' } },
    ];

    const onCard = async (values: Partial<typeof schema.message.$inferInsert>) => {
      const sentAt = new Date(Date.now() - 1_000);
      const customer = await seedCustomer(t.db, t.merchantA);
      const convo = await seedConversation(t.db, t.merchantA, {
        customerId: customer.id,
        facebookPageId: pageA,
        lastMessageAt: sentAt,
        lastInboundAt: sentAt,
        state: 'awaiting_confirmation',
      });
      const trigger = await seedMessage(t.db, t.merchantA, convo.id, { sentAt, ...values });
      return {
        convo,
        job: { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: trigger.id },
      };
    };
    const ordersOf = (conversationId: string) =>
      t.db.select().from(schema.order).where(eq(schema.order.conversationId, conversationId));

    it.each(EVENTS)(
      '$name on the card creates no order and points to Confirm',
      async ({ values }) => {
        const { convo, job } = await onCard(values);
        const before = await conversationRow(convo.id);

        await expect(service().run(job)).resolves.toBe('replied');

        expect(sent.map((message) => message.text)).toEqual([USE_CONFIRM]);
        expect(llm.calls).toEqual([]);
        expect(cardTaps).toEqual([]);
        expect(await ordersOf(convo.id)).toEqual([]);
        const after = await conversationRow(convo.id);
        expect(after).toMatchObject({
          state: 'awaiting_confirmation',
          collectedSlots: before?.collectedSlots,
        });
      },
    );

    it('stays silent for a reaction before the card, with no LLM call', async () => {
      const { job } = await thread();
      const reaction = await seedMessage(t.db, t.merchantA, job.conversationId, {
        kind: 'reaction',
        text: '😆',
        details: {
          reaction: { emoji: '😆', label: 'smile', targetMid: 'm', targetMessageId: null },
        },
      });

      await expect(service().run({ ...job, triggerMessageId: reaction.id })).resolves.toBe(
        'silent',
      );
      expect(sent).toEqual([]);
      expect(llm.calls).toEqual([]);
    });

    it('nudges a sticker before the card with a fixed line and no LLM call', async () => {
      const { convo, job } = await thread();
      const sticker = await seedMessage(t.db, t.merchantA, convo.id, {
        kind: 'sticker',
        text: '',
      });

      await expect(service().run({ ...job, triggerMessageId: sticker.id })).resolves.toBe(
        'replied',
      );
      expect(sent.map((message) => message.text)).toEqual([
        fallbackText({ kind: 'notice', notice: 'type_please' }, 'bn'),
      ]);
      expect(llm.calls).toEqual([]);
      expect((await conversationRow(convo.id))?.state).toBe('browsing');
    });

    it('reads an edited message as its edit, and answers it again', async () => {
      const { convo, job, trigger } = await thread();
      await service().run(job);
      await t.db
        .update(schema.message)
        .set({ editedText: 'blue saree', editedAt: new Date() })
        .where(eq(schema.message.id, trigger.id));
      llm.calls = [];

      await expect(service().run(job)).resolves.toBe('replied');
      // The edit keeps its place in the thread and replaces what was first sent.
      expect(llm.histories.at(-1)).toEqual([
        { from: 'customer', text: 'blue saree' },
        { from: 'assistant', text: 'Which product would you like?' },
      ]);
      expect((await messagesOf(convo.id)).filter((m) => m.sender === 'assistant')).toHaveLength(2);
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

  it('passes the offered profile name, and nothing when none was offered', () => {
    expect(
      extractionContext({ ...emptySlots(), offeredName: 'Nusrat Jahan' }, EVAL_CATALOG),
    ).toMatchObject({ offeredName: 'Nusrat Jahan' });
    expect(extractionContext(emptySlots(), EVAL_CATALOG)).not.toHaveProperty('offeredName');
  });
});
