import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../../config/app.config';
import * as schema from '../../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  type CatalogTestDb,
} from '../../../../database/__tests__/catalog-test-db';
import { randomPageId, seedFacebookPage } from '../../../../database/__tests__/conversation-seeds';
import type { CustomerMessageJob, PageEchoJob } from '../../../queue/queue.constants';
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import { GraphError, type MetaGraphClient } from '../../../messenger/page/meta-graph.client';
import { ConversationRepository } from '../../conversation.repository';
import { CustomerRepository } from '../../customer.repository';
import type { ConversationEvent } from '../../events/conversation-event';
import type { ConversationEventsPublisher } from '../../events/conversation-events.publisher';
import { MessageRepository } from '../../message.repository';
import { InboundMessageIngest } from '../inbound-message.ingest';

const OUR_APP = 'our-app-id';
const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

class FakeGraph {
  names = new Map<string, string>();
  profileCalls: { token: string; psid: string }[] = [];
  fail = false;
  async getUserName(token: string, psid: string) {
    this.profileCalls.push({ token, psid });
    if (this.fail) throw new GraphError(400, 100, 'no profile');
    return this.names.get(psid) ?? null;
  }
}

class FakePublisher {
  events: ConversationEvent[] = [];
  async publish(event: ConversationEvent) {
    this.events.push(event);
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
    ingest = new InboundMessageIngest(
      runtime.db,
      {
        get: (key: string) => (key === 'META_APP_ID' ? OUR_APP : undefined),
      } as unknown as AppConfig,
      crypto,
      graph as unknown as MetaGraphClient,
      new FacebookPageRepository(),
      new CustomerRepository(),
      new ConversationRepository(),
      new MessageRepository(),
      publisher as unknown as ConversationEventsPublisher,
    );
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it("stores a customer's first message as a new thread, named from their profile", async () => {
    const job = customerMessage();
    graph.names.set(job.senderPsid, 'Nusrat Jahan');

    await expect(ingest.handle(job)).resolves.toBe('stored');

    const thread = await threadOf(job.senderPsid);
    expect(thread?.customer).toMatchObject({ merchantId: t.merchantA, name: 'Nusrat Jahan' });
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
});
