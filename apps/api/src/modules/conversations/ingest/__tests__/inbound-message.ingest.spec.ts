import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedProduct,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { randomPageId, seedFacebookPage } from '../../../database/__tests__/conversation-seeds';
import {
  ASSISTANT_TURN_RETRY,
  type CustomerMessageJob,
  type CustomerPostbackJob,
  type CustomerReferralJob,
  type PageEchoJob,
} from '../../../queue/queue.constants';
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../../messenger/page/meta-graph.client';
import { ConversationRepository } from '../../conversation.repository';
import { REFERRAL_TEXT } from '../../assistant/assistant-fallbacks';
import { PROFILE_REFRESH_MS } from '../../conversation-rules';
import { CustomerRepository } from '../../customer.repository';
import type { ConversationEvent } from '../../events/conversation-event';
import type { ConversationEventsPublisher } from '../../events/conversation-events.publisher';
import { AdProductRepository } from '../../../messenger/ads/ad-product.repository';
import { MerchantSettingsRepository } from '../../../settings/merchant-settings.repository';
import { MessageRepository } from '../../message.repository';
import { CustomerProfileReader } from '../../profiles/customer-profile.reader';
import { InboundMessageIngest } from '../inbound-message.ingest';

const OUR_APP = 'our-app-id';
const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

class FakeGraph {
  profiles = new Map<string, { name: string | null; pictureUrl: string | null }>();
  profileCalls: { token: string; psid: string }[] = [];
  fail = false;
  async getUserProfile(token: string, psid: string) {
    this.profileCalls.push({ token, psid });
    if (this.fail) throw new GraphError(400, 100, 'no profile');
    return this.profiles.get(psid) ?? { name: null, pictureUrl: null };
  }
}

const PICTURE = 'https://platform-lookaside.fbsbx.com/pic?psid=1&oe=1';

class FakePublisher {
  events: ConversationEvent[] = [];
  async publish(event: ConversationEvent) {
    this.events.push(event);
  }
}

class FakeQueue {
  added: { name: string; data: unknown; opts: unknown }[] = [];
  async add(name: string, data: unknown, opts: unknown) {
    this.added.push({ name, data, opts });
  }
}

// As app_runtime: the Page lookup, the reads and the writes all run under the
// same row-level security as production.
describeDb('InboundMessageIngest (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let pageB: string;
  let graph: FakeGraph;
  let publisher: FakePublisher;
  let turns: FakeQueue;
  let ingest: InboundMessageIngest;

  const customerMessage = (overrides: Partial<CustomerMessageJob> = {}): CustomerMessageJob => ({
    kind: 'customer-message',
    messageId: `mid-${randomUUID()}`,
    pageId: pageA,
    senderPsid: `psid-${randomUUID()}`,
    text: 'Is the blue kurti available in M?',
    sentAt: Date.parse('2026-09-29T10:02:00Z'),
    ...overrides,
  });
  const echo = (overrides: Partial<PageEchoJob> = {}): PageEchoJob => ({
    kind: 'page-echo',
    messageId: `mid-${randomUUID()}`,
    pageId: pageA,
    recipientPsid: `psid-${randomUUID()}`,
    text: 'Yes, ৳ 1,600',
    sentAt: Date.parse('2026-09-29T10:03:00Z'),
    appId: 'page-inbox-app',
    ...overrides,
  });
  const conversationsOf = (merchantId: string) =>
    t.db.select().from(schema.conversation).where(eq(schema.conversation.merchantId, merchantId));
  const threadOf = async (psid: string) => {
    const [row] = await t.db
      .select({ conversation: schema.conversation, customer: schema.customer })
      .from(schema.conversation)
      .innerJoin(schema.customer, eq(schema.customer.id, schema.conversation.customerId))
      .where(eq(schema.customer.psid, psid));
    return row;
  };
  const messagesOf = (conversationId: string) =>
    t.db.select().from(schema.message).where(eq(schema.message.conversationId, conversationId));

  const defaultConfig = {
    get: (key: string) =>
      (({ META_APP_ID: OUR_APP, LLM_API_KEY: 'test-key' }) as Record<string, string | undefined>)[
        key
      ],
  } as unknown as AppConfig;
  const makeIngest = (config: AppConfig = defaultConfig) =>
    new InboundMessageIngest(
      runtime.db,
      config,
      new CustomerProfileReader(crypto, graph as unknown as MetaGraphClient),
      new FacebookPageRepository(),
      new CustomerRepository(),
      new ConversationRepository(),
      new MessageRepository(),
      new AdProductRepository(),
      new MerchantSettingsRepository(),
      publisher as unknown as ConversationEventsPublisher,
      turns as unknown as Queue,
    );

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    pageA = (await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') }))
      .pageId;
    pageB = (await seedFacebookPage(t.db, t.merchantB, { accessToken: crypto.encrypt('token-B') }))
      .pageId;
  });

  beforeEach(() => {
    graph = new FakeGraph();
    publisher = new FakePublisher();
    turns = new FakeQueue();
    ingest = makeIngest();
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it("stores a customer's first message as a new thread, named from their profile", async () => {
    const job = customerMessage();
    graph.profiles.set(job.senderPsid, { name: 'Nusrat Jahan', pictureUrl: PICTURE });

    await expect(ingest.handle(job)).resolves.toBe('stored');

    const thread = await threadOf(job.senderPsid);
    expect(thread?.customer).toMatchObject({
      merchantId: t.merchantA,
      name: 'Nusrat Jahan',
      pictureUrl: PICTURE,
    });
    expect(thread?.conversation).toMatchObject({
      facebookPageId: pageA,
      state: 'browsing',
      botPaused: false,
      lastMessagePreview: job.text,
      lastMessageSender: 'customer',
      lastInboundAt: new Date(job.sentAt),
    });
    expect(await messagesOf(thread!.conversation.id)).toMatchObject([
      { sender: 'customer', text: job.text, metaMessageId: job.messageId, status: 'sent' },
    ]);
    expect(graph.profileCalls).toEqual([{ token: 'token-A', psid: job.senderPsid }]);
    expect(publisher.events).toEqual([
      { merchantId: t.merchantA, conversationId: thread!.conversation.id, kind: 'message' },
    ]);
  });

  it('treats a redelivered message as a no-op', async () => {
    const job = customerMessage();
    await ingest.handle(job);

    await expect(ingest.handle(job)).resolves.toBe('duplicate');

    const thread = await threadOf(job.senderPsid);
    expect(await messagesOf(thread!.conversation.id)).toHaveLength(1);
    expect(publisher.events).toHaveLength(1);
  });

  it("stores a seller's reply from Facebook's inbox and pauses the assistant", async () => {
    const first = customerMessage();
    await ingest.handle(first);
    const reply = echo({ recipientPsid: first.senderPsid });
    publisher.events.length = 0;

    await expect(ingest.handle(reply)).resolves.toBe('stored');

    const thread = await threadOf(first.senderPsid);
    expect(thread?.conversation).toMatchObject({
      botPaused: true,
      lastMessageSender: 'seller',
      lastInboundAt: new Date(first.sentAt),
    });
    const stored = await messagesOf(thread!.conversation.id);
    expect(stored.find((row) => row.metaMessageId === reply.messageId)).toMatchObject({
      sender: 'seller',
      text: reply.text,
      status: 'sent',
    });
    expect(publisher.events).toEqual([
      { merchantId: t.merchantA, conversationId: thread!.conversation.id, kind: 'message' },
    ]);
  });

  it('skips the echo of a message our own app sent', async () => {
    const job = echo({ appId: OUR_APP });
    await expect(ingest.handle(job)).resolves.toBe('own-echo');
    expect(await threadOf(job.recipientPsid)).toBeUndefined();
    expect(publisher.events).toEqual([]);
  });

  it('drops a message for a Page no shop has connected', async () => {
    const job = customerMessage({ pageId: randomPageId() });
    await expect(ingest.handle(job)).resolves.toBe('unknown-page');
    expect(await threadOf(job.senderPsid)).toBeUndefined();
  });

  it('stores the message when the profile cannot be read, and waits before asking again', async () => {
    graph.fail = true;
    const first = customerMessage();
    await expect(ingest.handle(first)).resolves.toBe('stored');

    const thread = await threadOf(first.senderPsid);
    expect(thread?.customer.name).toBeNull();
    expect(thread?.customer.profileFetchedAt).toBeInstanceOf(Date);

    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));
    expect(graph.profileCalls).toHaveLength(1);
  });

  it("refreshes a named customer's picture once the refresh period has passed", async () => {
    const first = customerMessage();
    graph.profiles.set(first.senderPsid, { name: 'Nusrat Jahan', pictureUrl: PICTURE });
    await ingest.handle(first);

    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));
    expect(graph.profileCalls).toHaveLength(1);

    await t.db
      .update(schema.customer)
      .set({ profileFetchedAt: new Date(Date.now() - PROFILE_REFRESH_MS) })
      .where(eq(schema.customer.psid, first.senderPsid));
    const renewed = `${PICTURE}&oe=2`;
    graph.profiles.set(first.senderPsid, { name: 'Nusrat Jahan', pictureUrl: renewed });
    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));

    expect(graph.profileCalls).toHaveLength(2);
    expect((await threadOf(first.senderPsid))?.customer.pictureUrl).toBe(renewed);
  });

  it('keeps the known name and picture when a refresh fails', async () => {
    const first = customerMessage();
    graph.profiles.set(first.senderPsid, { name: 'Nusrat Jahan', pictureUrl: PICTURE });
    await ingest.handle(first);
    await t.db
      .update(schema.customer)
      .set({ profileFetchedAt: new Date(Date.now() - PROFILE_REFRESH_MS) })
      .where(eq(schema.customer.psid, first.senderPsid));

    graph.fail = true;
    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));

    expect((await threadOf(first.senderPsid))?.customer).toMatchObject({
      name: 'Nusrat Jahan',
      pictureUrl: PICTURE,
    });
  });

  it('keeps the newest message in the list when an older one arrives late', async () => {
    const psid = `psid-${randomUUID()}`;
    await ingest.handle(
      customerMessage({
        senderPsid: psid,
        text: 'newer',
        sentAt: Date.parse('2026-09-29T10:05:00Z'),
      }),
    );
    await ingest.handle(
      customerMessage({
        senderPsid: psid,
        text: 'older',
        sentAt: Date.parse('2026-09-29T10:04:00Z'),
      }),
    );

    const thread = await threadOf(psid);
    expect(thread?.conversation.lastMessagePreview).toBe('newer');
    expect(await messagesOf(thread!.conversation.id)).toHaveLength(2);
  });

  it("writes a new customer's simultaneous messages into one thread", async () => {
    const psid = `psid-${randomUUID()}`;
    await Promise.all([
      ingest.handle(customerMessage({ senderPsid: psid, text: 'one' })),
      ingest.handle(customerMessage({ senderPsid: psid, text: 'two' })),
    ]);

    const customers = await t.db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.psid, psid));
    expect(customers).toHaveLength(1);
    const thread = await threadOf(psid);
    expect(await messagesOf(thread!.conversation.id)).toHaveLength(2);
  });

  it("files each Page's messages under its own shop, as separate customers", async () => {
    const psid = `psid-${randomUUID()}`;
    await ingest.handle(customerMessage({ pageId: pageA, senderPsid: psid }));
    await ingest.handle(customerMessage({ pageId: pageB, senderPsid: psid }));

    const customers = await t.db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.psid, psid));
    expect(customers.map((row) => row.merchantId).sort()).toEqual(
      [t.merchantA, t.merchantB].sort(),
    );
    const inB = (await conversationsOf(t.merchantB)).filter((row) => row.facebookPageId === pageB);
    expect(inB).toHaveLength(1);
  });

  // Last in the file: it replaces merchant A's facebook_page row.
  it('continues the same thread after the Page is disconnected and reconnected', async () => {
    const psid = `psid-${randomUUID()}`;
    await ingest.handle(customerMessage({ senderPsid: psid, text: 'before' }));

    await t.db.delete(schema.facebookPage).where(eq(schema.facebookPage.merchantId, t.merchantA));
    await seedFacebookPage(t.db, t.merchantA, {
      pageId: pageA,
      accessToken: crypto.encrypt('token-A'),
    });

    await ingest.handle(customerMessage({ senderPsid: psid, text: 'after' }));

    const thread = await threadOf(psid);
    const sameCustomer = (await conversationsOf(t.merchantA)).filter(
      (row) => row.customerId === thread!.customer.id,
    );
    expect(sameCustomer).toHaveLength(1);
    expect(await messagesOf(thread!.conversation.id)).toHaveLength(2);
  });

  it("queues the assistant's turn after a customer's message", async () => {
    const job = customerMessage();
    await ingest.handle(job);

    const thread = await threadOf(job.senderPsid);
    const [stored] = await messagesOf(thread!.conversation.id);
    expect(turns.added).toEqual([
      {
        name: 'assistant-turn',
        data: {
          merchantId: t.merchantA,
          conversationId: thread!.conversation.id,
          triggerMessageId: stored!.id,
        },
        opts: { jobId: `turn-${job.messageId}`, delay: 2_500, ...ASSISTANT_TURN_RETRY },
      },
    ]);
  });

  it('keeps the colon BullMQ refuses out of the job id, one id per mid', async () => {
    const tail = randomUUID();
    await ingest.handle(customerMessage({ messageId: `m_${tail}:1` }));
    await ingest.handle(customerMessage({ messageId: `m_${tail}%3A1` }));

    const ids = turns.added.map((added) => (added.opts as { jobId: string }).jobId);
    expect(ids.every((id) => !id.includes(':'))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('queues nothing for a duplicate, an echo, or a paused conversation', async () => {
    const first = customerMessage();
    await ingest.handle(first);
    await ingest.handle(first);
    await ingest.handle(echo({ recipientPsid: first.senderPsid }));
    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));

    expect(turns.added).toHaveLength(1);
  });

  it('queues nothing while the conversation is handed off', async () => {
    const first = customerMessage();
    await ingest.handle(first);
    const thread = await threadOf(first.senderPsid);
    await t.db
      .update(schema.conversation)
      .set({ state: 'handed_off' })
      .where(eq(schema.conversation.id, thread!.conversation.id));

    await ingest.handle(customerMessage({ senderPsid: first.senderPsid }));

    expect(turns.added).toHaveLength(1);
  });

  it("queues nothing when the Page's assistant is switched off", async () => {
    await t.db
      .update(schema.facebookPage)
      .set({ botEnabled: false })
      .where(eq(schema.facebookPage.pageId, pageA));
    try {
      await ingest.handle(customerMessage());
      expect(turns.added).toEqual([]);
    } finally {
      await t.db
        .update(schema.facebookPage)
        .set({ botEnabled: true })
        .where(eq(schema.facebookPage.pageId, pageA));
    }
  });

  it('queues nothing without an LLM key', async () => {
    ingest = makeIngest({
      get: (key: string) => (key === 'META_APP_ID' ? OUR_APP : undefined),
    } as unknown as AppConfig);
    await ingest.handle(customerMessage());
    expect(turns.added).toEqual([]);
  });

  it('stores a button tap as a customer message with its payload and queues it at once', async () => {
    const first = customerMessage();
    await ingest.handle(first);
    const conversationId = (await threadOf(first.senderPsid))!.conversation.id;
    const tap: CustomerPostbackJob = {
      kind: 'customer-postback',
      messageId: `mid-${randomUUID()}`,
      pageId: pageA,
      senderPsid: first.senderPsid,
      text: 'Confirm',
      payload: `confirm:${conversationId}:1`,
      sentAt: Date.parse('2026-09-29T10:05:00Z'),
    };

    await expect(ingest.handle(tap)).resolves.toBe('stored');

    const stored = (await messagesOf(conversationId)).find(
      (m) => m.metaMessageId === tap.messageId,
    );
    expect(stored).toMatchObject({ sender: 'customer', text: 'Confirm', payload: tap.payload });
    expect(turns.added[1]).toMatchObject({
      data: { conversationId, triggerMessageId: stored!.id },
      opts: { jobId: `turn-${tap.messageId}`, delay: 0 },
    });
  });

  it('keeps a quick-reply payload and the usual delay', async () => {
    const job = customerMessage({ text: 'Red saree', payload: 'pick:product:abc' });
    await ingest.handle(job);

    const thread = await threadOf(job.senderPsid);
    const [stored] = await messagesOf(thread!.conversation.id);
    expect(stored?.payload).toBe('pick:product:abc');
    expect(turns.added[0]).toMatchObject({ opts: { delay: 2_500 } });
  });

  describe('on a confirmed chat', () => {
    const confirmedSlots = {
      items: [{ productId: randomUUID(), variantId: randomUUID(), quantity: 2 }],
      customerName: 'Rahim',
      phone: '+8801812345678',
      deliveryAddress: 'House 4, Road 2, Dhanmondi',
      deliveryArea: 'Dhaka',
      deliveryChargeId: randomUUID(),
      revision: 3,
      quote: {
        revision: 3,
        lines: [
          {
            productId: randomUUID(),
            variantId: randomUUID(),
            quantity: 2,
            unitPrice: 80_000,
            lineTotal: 160_000,
          },
        ],
        subtotal: 160_000,
        deliveryChargeId: randomUUID(),
        deliveryFee: 6_000,
        total: 166_000,
        currency: 'BDT',
      },
    };
    const confirmedChat = async () => {
      const first = customerMessage();
      await ingest.handle(first);
      const conversationId = (await threadOf(first.senderPsid))!.conversation.id;
      await t.db
        .update(schema.conversation)
        .set({ state: 'confirmed', collectedSlots: confirmedSlots })
        .where(eq(schema.conversation.id, conversationId));
      return { psid: first.senderPsid, conversationId };
    };
    const tap = (psid: string, payload: string): CustomerPostbackJob => ({
      kind: 'customer-postback',
      messageId: `mid-${randomUUID()}`,
      pageId: pageA,
      senderPsid: psid,
      text: 'Confirm',
      payload,
      sentAt: Date.parse('2026-09-29T10:06:00Z'),
    });

    it('starts the next order from a new message, keeping the details', async () => {
      const { psid, conversationId } = await confirmedChat();

      await ingest.handle(customerMessage({ senderPsid: psid, text: 'I want one more' }));

      const thread = await threadOf(psid);
      expect(thread!.conversation.state).toBe('browsing');
      expect(thread!.conversation.collectedSlots).toEqual({
        items: [],
        customerName: 'Rahim',
        phone: '+8801812345678',
        deliveryAddress: 'House 4, Road 2, Dhanmondi',
        deliveryArea: 'Dhaka',
        deliveryChargeId: confirmedSlots.deliveryChargeId,
        revision: 4,
      });
      expect(turns.added).toHaveLength(2);
      expect(turns.added[1]).toMatchObject({ data: { conversationId }, opts: { delay: 2_500 } });
    });

    it('stays confirmed for a tap on the summary card, and answers only Confirm', async () => {
      const { psid, conversationId } = await confirmedChat();

      await ingest.handle(tap(psid, `change:${conversationId}:3`));
      await ingest.handle(tap(psid, `confirm:${conversationId}:3`));

      const thread = await threadOf(psid);
      expect(thread!.conversation.state).toBe('confirmed');
      expect(thread!.conversation.collectedSlots).toEqual(confirmedSlots);
      expect(turns.added).toHaveLength(2);
      expect(turns.added[1]).toMatchObject({ opts: { delay: 0 } });
    });

    it('starts the next order even while the assistant is off', async () => {
      const { psid } = await confirmedChat();
      ingest = makeIngest({ get: () => undefined } as unknown as AppConfig);

      await ingest.handle(customerMessage({ senderPsid: psid, text: 'another one please' }));

      expect((await threadOf(psid))!.conversation.state).toBe('browsing');
      expect(turns.added).toHaveLength(1);
    });
  });

  const PRODUCT = randomUUID();
  const referralJob = (overrides: Partial<CustomerReferralJob> = {}): CustomerReferralJob => ({
    kind: 'customer-referral',
    messageId: `rf-${randomUUID()}`,
    pageId: pageA,
    senderPsid: `psid-${randomUUID()}`,
    text: '',
    referral: { kind: 'link', productId: PRODUCT },
    sentAt: Date.parse('2026-10-14T09:00:00Z'),
    ...overrides,
  });

  it('stores a standalone product link as a customer row carrying the ref payload, and queues at once', async () => {
    const job = referralJob();
    await expect(ingest.handle(job)).resolves.toBe('stored');

    const thread = await threadOf(job.senderPsid);
    expect(thread?.conversation.entrySource).toBe('link');
    expect(await messagesOf(thread!.conversation.id)).toMatchObject([
      { sender: 'customer', payload: `ref:product:${PRODUCT}`, text: REFERRAL_TEXT.bn.link },
    ]);
    expect(turns.added).toHaveLength(1);
    expect(turns.added[0]?.opts).toMatchObject({ delay: 0 });
  });

  it('records an unmapped ad and starts an organic chat marked as from an ad', async () => {
    const adId = `ad-${randomUUID()}`;
    const job = customerMessage({ referral: { kind: 'ad', adId }, text: 'price?' });
    await ingest.handle(job);

    const thread = await threadOf(job.senderPsid);
    expect(thread?.conversation.entrySource).toBe('ad');
    expect(await messagesOf(thread!.conversation.id)).toMatchObject([
      { text: 'price?', payload: null },
    ]);
    const [ad] = await t.db.select().from(schema.adProduct).where(eq(schema.adProduct.adId, adId));
    expect(ad).toMatchObject({ merchantId: t.merchantA, chatCount: 1, productId: null });
  });

  it('turns a mapped ad into the product it sells', async () => {
    const adId = `ad-${randomUUID()}`;
    const product = await seedProduct(t.db, t.merchantA, { name: 'Jamdani saree' });
    await t.db
      .insert(schema.adProduct)
      .values({ merchantId: t.merchantA, pageId: pageA, adId, productId: product.id });
    const job = customerMessage({ referral: { kind: 'ad', adId } });
    await ingest.handle(job);

    const thread = await threadOf(job.senderPsid);
    expect(await messagesOf(thread!.conversation.id)).toMatchObject([
      { payload: `ref:product:${product.id}` },
    ]);
  });

  it('counts a redelivered ad referral once', async () => {
    const adId = `ad-${randomUUID()}`;
    const job = customerMessage({ referral: { kind: 'ad', adId } });
    await expect(ingest.handle(job)).resolves.toBe('stored');
    await expect(ingest.handle(job)).resolves.toBe('duplicate');
    const [ad] = await t.db.select().from(schema.adProduct).where(eq(schema.adProduct.adId, adId));
    expect(ad?.chatCount).toBe(1);
  });

  it('marks Get Started without a referral as get_started', async () => {
    const job: CustomerPostbackJob = {
      kind: 'customer-postback',
      messageId: `mid-${randomUUID()}`,
      pageId: pageA,
      senderPsid: `psid-${randomUUID()}`,
      text: 'Get Started',
      payload: 'start',
      sentAt: Date.parse('2026-10-14T09:00:00Z'),
    };
    await ingest.handle(job);
    const thread = await threadOf(job.senderPsid);
    expect(thread?.conversation.entrySource).toBe('get_started');
    expect(await messagesOf(thread!.conversation.id)).toMatchObject([{ payload: 'start' }]);
  });

  it('stores a referral on a handed-off chat and queues nothing', async () => {
    const job = referralJob();
    await ingest.handle(customerMessage({ senderPsid: job.senderPsid }));
    const thread = await threadOf(job.senderPsid);
    await t.db
      .update(schema.conversation)
      .set({ state: 'handed_off' })
      .where(eq(schema.conversation.id, thread!.conversation.id));
    turns.added = [];

    await ingest.handle(job);
    expect((await threadOf(job.senderPsid))?.conversation.entrySource).toBe('link');
    expect(turns.added).toEqual([]);
  });

  it('resets the entry source when a confirmed chat starts its next order', async () => {
    const job = referralJob();
    await ingest.handle(job);
    const thread = await threadOf(job.senderPsid);
    await t.db
      .update(schema.conversation)
      .set({ state: 'confirmed' })
      .where(eq(schema.conversation.id, thread!.conversation.id));

    await ingest.handle(customerMessage({ senderPsid: job.senderPsid, text: 'one more please' }));
    expect((await threadOf(job.senderPsid))?.conversation.entrySource).toBe('organic');
  });

  it('never records another shop’s ad on this shop', async () => {
    const adId = `ad-${randomUUID()}`;
    await ingest.handle(customerMessage({ pageId: pageB, referral: { kind: 'ad', adId } }));
    const rows = await t.db.select().from(schema.adProduct).where(eq(schema.adProduct.adId, adId));
    expect(rows.map((row) => row.merchantId)).toEqual([t.merchantB]);
  });
});
