import { createHmac, randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import {
  createProductSchema,
  type CollectedSlots,
  type CustomerIntent,
  type ExtractedItem,
  type ExtractedOrder,
  type PhotoMatch,
  type IntentResult,
} from '@app/shared';
import type { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../../common/crypto.service';
import type { AppConfig } from '../../../../config/app.config';
import { envSchema } from '../../../../config/env.schema';
import type { CatalogTestDb } from '../../../../database/__tests__/catalog-test-db';
import { seedFacebookPage } from '../../../../database/__tests__/conversation-seeds';
import type { Database } from '../../../../database/database.module';
import * as schema from '../../../../database/schema/index';
import { AiSdkLlmClient } from '../../../../llm/ai-sdk-llm.client';
import type { LlmClient, LlmPurpose, LlmResult } from '../../../../llm/llm.types';
import { MessengerController } from '../../../../messenger/messenger.controller';
import { FacebookPageRepository } from '../../../../messenger/page/facebook-page.repository';
import type { GraphOption, MetaGraphClient } from '../../../../messenger/page/meta-graph.client';
import type { RawBodyRequest } from '../../../../messenger/raw-body';
import type { MetaWebhookBody } from '../../../../messenger/webhook-payload';
import type { NotificationsService } from '../../../../notifications/notifications.service';
import { DeliveryQuoteService } from '../../../../orders/delivery-quote.service';
import { OrderCatalogRepository } from '../../../../orders/order-catalog.repository';
import { OrderEventsRepository } from '../../../../orders/order-events.repository';
import { OrdersRepository } from '../../../../orders/orders.repository';
import { OrdersService } from '../../../../orders/orders.service';
import { ProductDeliveryRepository } from '../../../../products/product-delivery.repository';
import { productsService } from '../../../../products/__tests__/products-service.fixture';
import {
  INBOUND_MESSAGE_JOB,
  type AssistantTurnJob,
  type InboundMessageJob,
} from '../../../../queue/queue.constants';
import { AssistantSettingsRepository } from '../../../../settings/assistant-settings.repository';
import { AssistantSettingsService } from '../../../../settings/assistant-settings.service';
import { DeliveryChargesRepository } from '../../../../settings/delivery-charges.repository';
import { MerchantSettingsRepository } from '../../../../settings/merchant-settings.repository';
import { InMemoryObjectStorage } from '../../../../storage/__tests__/in-memory-object-storage';
import { ConversationRepository } from '../../../conversation.repository';
import { CustomerRepository } from '../../../customer.repository';
import type { ConversationEventsPublisher } from '../../../events/conversation-events.publisher';
import { InboundMessageIngest } from '../../../ingest/inbound-message.ingest';
import { InboundMessageProcessor } from '../../../ingest/inbound-message.processor';
import { AdProductRepository } from '../../../../messenger/ads/ad-product.repository';
import { ProductPostRepository } from '../../../../messenger/posts/product-post.repository';
import { SharedPostResolver } from '../../../../messenger/posts/shared-post.resolver';
import { MessageRepository } from '../../../message.repository';
import { OutboundMessageSender } from '../../../outbound-message.sender';
import { CustomerPhotoStore } from '../../../photos/customer-photo.store';
import { CustomerProfileReader } from '../../../profiles/customer-profile.reader';
import { AssistantTurnProcessor } from '../../assistant-turn.processor';
import { AssistantTurnService } from '../../assistant-turn.service';
import { readSlots } from '../../conversation-machine';
import { LlmCallRepository } from '../../llm-call.repository';
import { OrderConfirmationService } from '../../order-confirmation.service';

const APP_ID = 'simulator-app';
const APP_SECRET = 'simulator-secret';
const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);

/** What the scripted model answers for one customer message. */
export interface ScriptedTurn {
  intent: CustomerIntent;
  items?: Partial<ExtractedItem>[] | null;
  customerName?: string;
  phone?: string;
  deliveryAddress?: string;
  deliveryArea?: string;
}

export type Step =
  | { say: string; llm?: ScriptedTurn }
  /** Taps the quick reply with this title, from the latest quick replies sent. */
  | { quickReply: string }
  /** Taps a button on a card we sent: the latest, or the `card`-th (0-based). */
  | { button: 'confirm' | 'change'; card?: number };

export interface Sent {
  kind: 'text' | 'quick_replies' | 'card' | 'image';
  text: string;
  options: GraphOption[];
}

export interface CreatedOrder {
  reference: string;
  source: string;
  total: number;
  lines: { variantId: string | null; quantity: number; unitPrice: number }[];
}

export interface StepResult {
  sends: Sent[];
  outcomes: string[];
  state: string;
  slots: CollectedSlots;
  ordersCreated: CreatedOrder[];
  llmCalls: LlmPurpose[];
}

/** Behaves as BullMQ's add does for us: a colon in a custom id throws, a known id is a no-op. */
class MemoryQueue<T> {
  private readonly ids = new Set<string>();
  pending: { name: string; data: T; id: string }[] = [];
  async add(name: string, data: T, opts: { jobId?: string } = {}) {
    const id = opts.jobId ?? randomUUID();
    if (id.includes(':')) throw new Error(`Custom Id cannot contain : (${id})`);
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.pending.push({ name, data, id });
  }
  drain() {
    const jobs = this.pending;
    this.pending = [];
    return jobs;
  }
}

/** The scripted model: each message step sets `next`, its answers. */
class ScriptedLlm implements LlmClient {
  next: ScriptedTurn | null = null;
  calls: LlmPurpose[] = [];
  private usage = (purpose: LlmPurpose) => ({
    purpose,
    model: 'scripted',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  });
  private turn(): ScriptedTurn {
    if (!this.next) throw new Error('This step called the model but scripts no LLM turn');
    return this.next;
  }
  async classifyIntent(): Promise<LlmResult<IntentResult>> {
    this.calls.push('classify');
    return {
      ok: true,
      value: { intent: this.turn().intent, confidence: 0.95 },
      usage: this.usage('classify'),
    };
  }
  async extractOrder(): Promise<LlmResult<ExtractedOrder>> {
    this.calls.push('extract');
    const turn = this.turn();
    return {
      ok: true,
      value: {
        items:
          turn.items === undefined || turn.items === null
            ? null
            : turn.items.map((item) => ({
                ref: null,
                productQuery: null,
                productQueryAlt: null,
                variantQuery: null,
                variantQueryAlt: null,
                quantity: null,
                ...item,
              })),
        customerName: turn.customerName ?? null,
        phone: turn.phone ?? null,
        deliveryAddress: turn.deliveryAddress ?? null,
        deliveryArea: turn.deliveryArea ?? null,
        confidence: 0.95,
      },
      usage: this.usage('extract'),
    };
  }
  /** Fails, so every ask goes out as its fixed sentence and the transcript is stable. */
  async phraseReply(): Promise<LlmResult<string>> {
    this.calls.push('phrase');
    return { ok: false, reason: 'timeout', usage: this.usage('phrase') };
  }
  /** The simulator sends no photos; a step that does sees no match. */
  async matchProductPhoto(): Promise<LlmResult<PhotoMatch>> {
    this.calls.push('vision_match');
    return { ok: true, value: { matches: [] }, usage: this.usage('vision_match') };
  }

  /** The assistant never reads posts into products. */
  extractProductsFromPost(): never {
    throw new Error('The assistant never imports posts');
  }
}

/** Counts calls on the real client so the transcript can show them. */
class CountingLlm implements LlmClient {
  calls: LlmPurpose[] = [];
  constructor(private readonly inner: LlmClient) {}
  classifyIntent(...args: Parameters<LlmClient['classifyIntent']>) {
    this.calls.push('classify');
    return this.inner.classifyIntent(...args);
  }
  extractOrder(...args: Parameters<LlmClient['extractOrder']>) {
    this.calls.push('extract');
    return this.inner.extractOrder(...args);
  }
  phraseReply(...args: Parameters<LlmClient['phraseReply']>) {
    this.calls.push('phrase');
    return this.inner.phraseReply(...args);
  }
  matchProductPhoto(...args: Parameters<LlmClient['matchProductPhoto']>) {
    this.calls.push('vision_match');
    return this.inner.matchProductPhoto(...args);
  }

  extractProductsFromPost(...args: Parameters<LlmClient['extractProductsFromPost']>) {
    this.calls.push('post_import');
    return this.inner.extractProductsFromPost(...args);
  }
}

export const liveLlm = process.env.LLM_EVAL === '1' && Boolean(process.env.LLM_API_KEY);

function makeLlm(): ScriptedLlm | CountingLlm {
  if (!liveLlm) return new ScriptedLlm();
  const env = envSchema.parse(process.env);
  const openai = createOpenAI({ apiKey: env.LLM_API_KEY });
  return new CountingLlm(
    new AiSdkLlmClient({
      routing: openai(env.LLM_MODEL_ROUTING),
      extraction: openai(env.LLM_MODEL_EXTRACTION),
      timeoutMs: env.LLM_TIMEOUT_MS,
    }),
  );
}

export interface SimProduct {
  name: string;
  aliases?: string[];
  /** One option's values, each a variant at `price`; none for a single variant. */
  colors?: string[];
  price: number;
  stock?: number;
}

/**
 * Plays a scripted Messenger conversation through the worker's code against
 * the real local database, with no Redis or HTTP server. Each step becomes a
 * signed webhook for MessengerController, its jobs run through the inbound and
 * assistant processors, and Graph sends go to a fake client that echoes them
 * back as Meta does.
 */
export class ConversationSimulator {
  readonly psid = `sim-psid-${randomUUID()}`;
  readonly transcript: string[] = [];
  private readonly sends: Sent[] = [];
  private readonly cards: Sent[] = [];
  private readonly inbound = new MemoryQueue<InboundMessageJob>();
  private readonly turns = new MemoryQueue<AssistantTurnJob>();
  private readonly llm = makeLlm();
  private readonly names = new Map<string, string>();
  private clock = Date.now() - 60_000;
  private stepNumber = 0;
  private conversationId: string | null = null;
  /** Order ids `orderDrafted` was called with. */
  readonly drafted: string[] = [];
  private readonly controller: MessengerController;
  private readonly ingest: InboundMessageProcessor;
  private readonly assistant: AssistantTurnProcessor;

  private constructor(
    private readonly t: CatalogTestDb,
    runtime: Database,
    private readonly pageId: string,
  ) {
    const config = {
      get: (key: string) =>
        (
          ({
            META_APP_ID: APP_ID,
            META_APP_SECRET: APP_SECRET,
            LLM_API_KEY: liveLlm ? process.env.LLM_API_KEY : 'scripted',
            ASSISTANT_LANGUAGES: ['en', 'bn'],
          }) as Record<string, unknown>
        )[key],
    } as unknown as AppConfig;
    const record =
      (kind: Sent['kind']) =>
      async (_token: string, _psid: string, text: string, options: GraphOption[] = []) => {
        const sent = { kind, text, options };
        this.sends.push(sent);
        if (kind === 'card') this.cards.push(sent);
        return { messageId: `m_sim_out_${randomUUID()}` };
      };
    const graph = {
      sendText: record('text'),
      sendQuickReplies: record('quick_replies'),
      sendButtonTemplate: record('card'),
      sendImage: record('image'),
      getUserProfile: async () => ({ name: 'Rahim Uddin', pictureUrl: null }),
    } as unknown as MetaGraphClient;
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    const notifications = {
      orderDrafted: async (_merchantId: string, orderId: string) => {
        this.drafted.push(orderId);
      },
      handedOff: async () => undefined,
    } as unknown as NotificationsService;

    const conversations = new ConversationRepository();
    const messages = new MessageRepository();
    const pages = new FacebookPageRepository();
    const settings = new MerchantSettingsRepository();
    const charges = new DeliveryChargesRepository();
    const catalog = new OrderCatalogRepository();
    const orders = new OrdersRepository();
    const outbound = new OutboundMessageSender(
      runtime,
      conversations,
      messages,
      crypto,
      graph,
      publisher,
    );
    const confirmation = new OrderConfirmationService(
      runtime,
      conversations,
      messages,
      pages,
      settings,
      charges,
      catalog,
      orders,
      new OrdersService(runtime, orders, new OrderEventsRepository(), catalog, settings, charges),
      new DeliveryQuoteService(
        runtime,
        charges,
        new ProductDeliveryRepository(),
        catalog,
        settings,
      ),
      outbound,
      notifications,
    );
    this.controller = new MessengerController(config, this.inbound as unknown as Queue);
    this.ingest = new InboundMessageProcessor(
      new InboundMessageIngest(
        runtime,
        config,
        new CustomerProfileReader(crypto, graph),
        pages,
        new CustomerRepository(),
        conversations,
        messages,
        new AdProductRepository(),
        settings,
        publisher,
        this.turns as unknown as Queue,
        { add: async () => undefined } as unknown as Queue,
      ),
    );
    this.assistant = new AssistantTurnProcessor(
      new AssistantTurnService(
        runtime,
        conversations,
        messages,
        pages,
        settings,
        charges,
        productsService(runtime),
        new LlmCallRepository(),
        this.llm,
        outbound,
        notifications,
        confirmation,
        orders,
        new SharedPostResolver(runtime, new ProductPostRepository(), crypto, graph, () =>
          Promise.reject(new Error('the simulator follows no links')),
        ),
        new ProductPostRepository(),
        new CustomerPhotoStore(runtime, messages, new InMemoryObjectStorage(), async () => ({
          ok: false,
          reason: 'not_allowed',
        })),

        new AssistantSettingsService(runtime, new AssistantSettingsRepository(), config),
      ),
    );
  }

  /** A shop for merchant A: its Page, settings, delivery rows and catalog. */
  static async open(
    t: CatalogTestDb,
    runtime: Database,
    shop: {
      products: SimProduct[];
      areas: { name: string | null; charge: number }[];
    },
  ): Promise<ConversationSimulator> {
    const page = await seedFacebookPage(t.db, t.merchantA, {
      accessToken: crypto.encrypt('simulator-token'),
    });
    await t.db
      .insert(schema.merchantSettings)
      .values({
        merchantId: t.merchantA,
        country: 'BD',
        currency: 'BDT',
        timeZone: 'Asia/Dhaka',
        dateFormat: 'dd/MM/yyyy',
      })
      .onConflictDoNothing();
    await t.db.insert(schema.deliveryCharge).values(
      shop.areas.map((area, position) => ({
        merchantId: t.merchantA,
        areaName: area.name,
        isFallback: area.name === null,
        charge: area.charge,
        position,
      })),
    );
    const sim = new ConversationSimulator(t, runtime, page.pageId);
    const products = productsService(t.db);
    for (const product of shop.products) {
      const created = await products.create(
        t.merchantA,
        createProductSchema.parse({
          name: product.name,
          aliases: product.aliases ?? [],
          status: 'active',
          options: product.colors
            ? [{ name: 'Color', values: product.colors.map((value) => ({ value })) }]
            : [],
          variants: (product.colors ?? [null]).map((color) => ({
            ...(color ? { optionValues: [color] } : {}),
            price: product.price,
            stock: product.stock ?? 10,
          })),
        }),
      );
      sim.names.set(created.id, created.name);
      for (const variant of created.variants) {
        sim.names.set(variant.id, [created.name, variant.name].filter(Boolean).join(' / '));
      }
    }
    return sim;
  }

  get mode(): 'scripted' | 'live' {
    return liveLlm ? 'live' : 'scripted';
  }

  variantId(label: string): string {
    const found = [...this.names].find(([, name]) => name === label);
    if (!found) throw new Error(`No variant named ${label}`);
    return found[0];
  }

  async step(step: Step): Promise<StepResult> {
    this.stepNumber += 1;
    const sendsBefore = this.sends.length;
    const draftedBefore = this.drafted.length;
    const ordersBefore = new Set((await this.orders()).map((order) => order.reference));
    this.llm.calls = [];
    if (this.llm instanceof ScriptedLlm) this.llm.next = 'say' in step ? (step.llm ?? null) : null;

    const { event, label } = this.eventFor(step);
    this.transcript.push(`\n── step ${this.stepNumber} · ${label}`);
    await this.post([event]);
    const outcomes: string[] = [];
    for (const job of this.inbound.drain()) await this.runInbound(job);
    for (const job of this.turns.drain()) {
      outcomes.push(
        await this.assistant.process({
          name: job.name,
          data: job.data,
          id: job.id,
        } as Job<AssistantTurnJob>),
      );
      this.conversationId = job.data.conversationId;
    }

    const sends = this.sends.slice(sendsBefore);
    await this.post(
      sends.map(() => ({
        sender: { id: this.pageId },
        recipient: { id: this.psid },
        timestamp: this.tick(),
        message: { mid: `m_sim_echo_${randomUUID()}`, text: 'echo', is_echo: true, app_id: APP_ID },
      })),
    );
    for (const job of this.inbound.drain()) await this.runInbound(job);

    const row = await this.conversation();
    const slots = readSlots(row?.collectedSlots);
    const ordersCreated = (await this.orders()).filter(
      (order) => !ordersBefore.has(order.reference),
    );
    for (const sent of sends) this.transcript.push(...this.describeSend(sent));
    this.transcript.push(`   turn: ${outcomes.join(', ') || '(none queued)'}`);
    this.transcript.push(`   llm calls: ${this.llm.calls.join(', ') || 'none'}`);
    for (const orderId of this.drafted.slice(draftedBefore)) {
      this.transcript.push(`   orderDrafted queued for ${orderId}`);
    }
    this.transcript.push(`   state: ${row?.state ?? '(no conversation)'}`);
    this.transcript.push(...this.describeSlots(slots).map((line) => `   ${line}`));
    for (const order of ordersCreated) {
      this.transcript.push(
        `   order created: ${order.reference} (${order.source}), total ${order.total}, ${order.lines
          .map(
            (line) =>
              `${this.names.get(line.variantId ?? '')} ×${line.quantity} @ ${line.unitPrice}`,
          )
          .join('; ')}`,
      );
    }
    return {
      sends,
      outcomes,
      state: row?.state ?? '',
      slots,
      ordersCreated,
      llmCalls: [...this.llm.calls],
    };
  }

  print(title: string): void {
    process.stdout.write(`\n=== ${title} (${this.mode} LLM) ===${this.transcript.join('\n')}\n`);
  }

  async orders(): Promise<CreatedOrder[]> {
    if (!this.conversationId) return [];
    const rows = await this.t.db
      .select()
      .from(schema.order)
      .where(eq(schema.order.conversationId, this.conversationId));
    return Promise.all(
      rows.map(async (row) => ({
        reference: row.reference,
        source: row.source,
        total: row.total,
        lines: (
          await this.t.db
            .select()
            .from(schema.orderItem)
            .where(eq(schema.orderItem.orderId, row.id))
        ).map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      })),
    );
  }

  private async conversation() {
    if (!this.conversationId) return undefined;
    const [row] = await this.t.db
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.id, this.conversationId));
    return row;
  }

  /** Meta's timestamps only move forward, and stay ahead of the replies we stamp. */
  private tick(): number {
    this.clock = Math.max(Date.now(), this.clock + 10);
    return this.clock;
  }

  private eventFor(step: Step): {
    event: NonNullable<NonNullable<MetaWebhookBody['entry']>[number]['messaging']>[number];
    label: string;
  } {
    const base = {
      sender: { id: this.psid },
      recipient: { id: this.pageId },
      timestamp: this.tick(),
    };
    const mid = `m_sim_${randomUUID()}`;
    if ('say' in step) {
      return {
        event: { ...base, message: { mid, text: step.say } },
        label: `customer: "${step.say}"`,
      };
    }
    if ('quickReply' in step) {
      const offered = [...this.sends].reverse().find((sent) => sent.kind === 'quick_replies');
      const option = offered?.options.find((entry) => entry.title === step.quickReply);
      if (!option) throw new Error(`No quick reply titled ${step.quickReply} was offered`);
      return {
        event: {
          ...base,
          message: { mid, text: option.title, quick_reply: { payload: option.payload } },
        },
        label: `customer taps quick reply "${option.title}" (${option.payload})`,
      };
    }
    const card = step.card === undefined ? this.cards.at(-1) : this.cards[step.card];
    const button = card?.options.find((entry) => entry.payload.startsWith(`${step.button}:`));
    if (!button) throw new Error(`No card with a ${step.button} button was sent`);
    return {
      event: { ...base, postback: { mid, title: button.title, payload: button.payload } },
      label: `customer taps "${button.title}" on card ${step.card ?? this.cards.length - 1} (${button.payload})`,
    };
  }

  private async post(
    events: NonNullable<NonNullable<MetaWebhookBody['entry']>[number]['messaging']>,
  ): Promise<void> {
    if (events.length === 0) return;
    const body: MetaWebhookBody = {
      object: 'page',
      entry: [{ id: this.pageId, messaging: events }],
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
    await this.controller.receive({ rawBody } as RawBodyRequest, signature);
  }

  private async runInbound(job: { name: string; data: InboundMessageJob; id: string }) {
    const outcome = await this.ingest.process({
      name: job.name,
      data: job.data,
      id: job.id,
    } as Job<InboundMessageJob>);
    if (job.name !== INBOUND_MESSAGE_JOB || (outcome !== 'stored' && outcome !== 'own-echo')) {
      throw new Error(`Inbound job ${job.id} ended ${outcome}`);
    }
  }

  private describeSend(sent: Sent): string[] {
    const head = `   → ${sent.kind}: `;
    const lines = sent.text.split('\n');
    const out = [
      `${head}${lines[0]}`,
      ...lines.slice(1).map((line) => `${' '.repeat(head.length)}${line}`),
    ];
    if (sent.options.length > 0) {
      out.push(
        `${' '.repeat(head.length)}[${sent.options.map((option) => `${option.title} → ${option.payload}`).join(' | ')}]`,
      );
    }
    return out;
  }

  private describeSlots(slots: CollectedSlots): string[] {
    const items = slots.items.map((item, index) => {
      const matched = item.variantId
        ? this.names.get(item.variantId)
        : item.productId
          ? `${this.names.get(item.productId)} / ?`
          : '?';
      const words = [item.productQuery, item.variantQuery].filter(Boolean).join(' + ');
      return `[${index}] "${words}" → ${matched} ×${item.quantity ?? '?'}`;
    });
    const details = [
      slots.customerName && `name ${slots.customerName}`,
      slots.phone && `phone ${slots.phone}`,
      slots.deliveryAddress && `address ${slots.deliveryAddress}`,
    ].filter(Boolean);
    const quote = slots.quote
      ? `quote r${slots.quote.revision}: subtotal ${slots.quote.subtotal} + fee ${slots.quote.deliveryFee} = ${slots.quote.total} ${slots.quote.currency}`
      : 'no quote';
    return [
      `items: ${items.join('; ') || 'none'}`,
      `details: ${details.join(', ') || 'none'}`,
      `revision ${slots.revision}, ${quote}${slots.lastAsked ? `, last asked ${slots.lastAsked.slot}${slots.lastAsked.item === undefined ? '' : `[${slots.lastAsked.item}]`} ×${slots.lastAsked.times}` : ''}`,
    ];
  }
}
