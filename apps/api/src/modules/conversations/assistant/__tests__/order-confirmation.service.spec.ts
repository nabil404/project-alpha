import { Logger } from '@nestjs/common';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import { createProductSchema, emptySlots, type CollectedSlots } from '@app/shared';
import { eq } from 'drizzle-orm';
import { CryptoService } from '../../../../common/crypto.service';
import type { AppConfig } from '../../../config/app.config';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
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
import { FacebookPageRepository } from '../../../messenger/page/facebook-page.repository';
import type { GraphOption, MetaGraphClient } from '../../../messenger/page/meta-graph.client';
import type { NotificationsService } from '../../../notifications/notifications.service';
import { DeliveryQuoteService } from '../../../orders/delivery-quote.service';
import { OrderCatalogRepository } from '../../../orders/order-catalog.repository';
import { OrderEventsRepository } from '../../../orders/order-events.repository';
import { OrdersRepository } from '../../../orders/orders.repository';
import { OrdersService } from '../../../orders/orders.service';
import { ProductDeliveryRepository } from '../../../products/product-delivery.repository';
import { productsService } from '../../../products/__tests__/products-service.fixture';
import { DeliveryChargesRepository } from '../../../settings/delivery-charges.repository';
import { MerchantSettingsRepository } from '../../../settings/merchant-settings.repository';
import { ConversationRepository } from '../../conversation.repository';
import { ConversationsService } from '../../conversations.service';
import type { ConversationEventsPublisher } from '../../events/conversation-events.publisher';
import { MessageRepository, SEND_LEASE_SECONDS } from '../../message.repository';
import { OutboundMessageSender } from '../../outbound-message.sender';
import { confirmText } from '../assistant-fallbacks';
import { quoteFor, readSlots, type DeliveryView } from '../conversation-machine';
import {
  OrderConfirmationService,
  ReplyInFlightError,
  type CardTap,
} from '../order-confirmation.service';

/** A worker that dies between commit and the Graph send, `crashes` times. */
let crashes = 0;
class CrashingSender extends OutboundMessageSender {
  override deliver(...args: Parameters<OutboundMessageSender['deliver']>) {
    if (crashes > 0) {
      crashes -= 1;
      return Promise.reject(new Error('worker died'));
    }
    return super.deliver(...args);
  }
}

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
let nextMid = 1;

/**
 * Reads every variant as having 10 more available than it does: the
 * confirmation's check passes, and only the reservation sees the truth, as
 * when another customer's draft takes the stock between the two.
 */
class StaleCatalog extends OrderCatalogRepository {
  override async findVariants(
    ...args: Parameters<OrderCatalogRepository['findVariants']>
  ): ReturnType<OrderCatalogRepository['findVariants']> {
    const variants = await super.findVariants(...args);
    return new Map(
      [...variants].map(([id, variant]) => [id, { ...variant, available: variant.available + 10 }]),
    );
  }
}

/** An order write that fails for a reason other than stock. */
class FailingOrders extends OrdersService {
  override async createInTransaction(
    ...args: Parameters<OrdersService['createInTransaction']>
  ): ReturnType<OrdersService['createInTransaction']> {
    void args;
    throw new Error('order write failed');
  }
}

describeDb('OrderConfirmationService (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let fallbackA: string;
  let sent: { kind: string; text: string; payloads: string[] }[];
  let drafted: { orderId: string; committed: boolean }[];
  let notifyFailures: number;
  let sendFailures: number;
  /** Holds every Graph send until opened, counting the sends that wait. */
  let gate: { waiting: number; open: Promise<void> } | null;

  const send =
    (kind: string) =>
    async (_token: string, _psid: string, text: string, options: GraphOption[] = []) => {
      if (sendFailures > 0) {
        sendFailures -= 1;
        throw new Error('graph down');
      }
      if (gate) {
        gate.waiting += 1;
        await gate.open;
      }
      sent.push({ kind, text, payloads: options.map((option) => option.payload) });
      return { messageId: `mid-confirm-${nextMid++}` };
    };
  const graph = {
    sendText: send('text'),
    sendButtonTemplate: send('card'),
    sendQuickReplies: send('quick_replies'),
  } as unknown as MetaGraphClient;

  const ordersFor = (conversationId: string) =>
    t.db.select().from(schema.order).where(eq(schema.order.conversationId, conversationId));

  const service = (
    catalog: OrderCatalogRepository = new OrderCatalogRepository(),
    ordersClass: typeof OrdersService = OrdersService,
  ) => {
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    const settings = new MerchantSettingsRepository();
    const charges = new DeliveryChargesRepository();
    const orders = new OrdersRepository();
    return new OrderConfirmationService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      settings,
      charges,
      catalog,
      orders,
      new ordersClass(runtime.db, orders, new OrderEventsRepository(), catalog, settings, charges),
      new DeliveryQuoteService(
        runtime.db,
        charges,
        new ProductDeliveryRepository(),
        catalog,
        settings,
      ),
      new CrashingSender(
        runtime.db,
        new ConversationRepository(),
        new MessageRepository(),
        crypto,
        graph,
        publisher,
      ),
      {
        orderDrafted: async (_merchantId: string, orderId: string) => {
          if (notifyFailures > 0) {
            notifyFailures -= 1;
            throw new Error('queue down');
          }
          // Read on another connection: only a committed order is visible there.
          const [row] = await t.db.select().from(schema.order).where(eq(schema.order.id, orderId));
          drafted.push({ orderId, committed: row !== undefined });
        },
      } as unknown as NotificationsService,
    );
  };

  /** A product with one variant, sold by merchant A. */
  const product = async (name: string, price: number, stock = 5) => {
    const row = await seedProduct(t.db, t.merchantA, { name, status: 'active' });
    const variant = await seedVariant(t.db, t.merchantA, row.id, {
      name: null,
      isDefault: true,
      price,
      stock,
    });
    return { productId: row.id, variantId: variant.id, price };
  };

  /** A conversation showing the card for `lines` at revision 1, and a tap on its button. */
  const shown = async (
    lines: { productId: string; variantId: string; price: number; quantity: number }[],
    overrides: Partial<typeof schema.conversation.$inferInsert> = {},
  ) => {
    const customer = await seedCustomer(t.db, t.merchantA);
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const slots: CollectedSlots = {
      ...emptySlots(),
      items: lines.map((line) => ({
        productQuery: 'words',
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
      customerName: 'Rahim',
      phone: '+8801812000000',
      deliveryAddress: 'Zindabazar, Sylhet',
      deliveryChargeId: fallbackA,
      revision: 1,
      quote: {
        revision: 1,
        lines: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.price,
          lineTotal: line.price * line.quantity,
        })),
        subtotal,
        deliveryChargeId: fallbackA,
        deliveryFee: 12_000,
        total: subtotal + 12_000,
        currency: 'BDT',
      },
    };
    const convo = await seedConversation(t.db, t.merchantA, {
      customerId: customer.id,
      facebookPageId: pageA,
      state: 'awaiting_confirmation',
      collectedSlots: slots,
      ...overrides,
    });
    return convo;
  };
  const tap = async (conversationId: string, payload: CardTap, merchantId = t.merchantA) => {
    const message = await seedMessage(t.db, t.merchantA, conversationId, {
      text: payload.kind === 'confirm' ? 'Confirm' : 'Change something',
      payload: `${payload.kind}:${payload.conversationId}:${payload.revision}`,
    });
    return service().run({ merchantId, conversationId, triggerMessageId: message.id }, payload);
  };
  const confirm = (conversationId: string, revision = 1): CardTap => ({
    kind: 'confirm',
    conversationId,
    revision,
  });
  /** Ages the conversation's in-flight replies past the send lease, as if their sender died. */
  const outlived = (conversationId: string) =>
    t.db
      .update(schema.message)
      .set({ updatedAt: new Date(Date.now() - (SEND_LEASE_SECONDS + 1) * 1000) })
      .where(eq(schema.message.conversationId, conversationId));
  const conversationRow = async (id: string) =>
    (await t.db.select().from(schema.conversation).where(eq(schema.conversation.id, id)))[0]!;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
    pageA = (await seedFacebookPage(t.db, t.merchantA, { accessToken: crypto.encrypt('token-A') }))
      .pageId;
    const [fallback] = await t.db
      .insert(schema.deliveryCharge)
      .values({
        merchantId: t.merchantA,
        areaName: null,
        isFallback: true,
        charge: 12_000,
        position: 0,
      })
      .returning();
    fallbackA = fallback!.id;
  });
  beforeEach(() => {
    sent = [];
    drafted = [];
    notifyFailures = 0;
    sendFailures = 0;
    crashes = 0;
    gate = null;
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('reserves the stock when the customer confirms', async () => {
    const lungi = await product('Reserving Lungi', 10_000, 4);
    const convo = await shown([{ ...lungi, quantity: 3 }]);

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('ordered');

    const [variant] = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, lungi.variantId));
    expect(variant).toMatchObject({ stock: 4, reserved: 3 });
  });

  it('refuses a confirm when drafts already hold the stock', async () => {
    const lungi = await product('Held Lungi', 10_000, 2);
    await t.db
      .update(schema.productVariant)
      .set({ reserved: 2 })
      .where(eq(schema.productVariant.id, lungi.variantId));
    const convo = await shown([{ ...lungi, quantity: 1 }]);

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('unavailable');
    expect(await ordersFor(convo.id)).toEqual([]);
  });

  it('answers unavailable when another draft takes the stock between check and reserve', async () => {
    const lungi = await product('Raced Lungi', 10_000, 1);
    const convo = await shown([{ ...lungi, quantity: 2 }]);
    const message = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
    });

    await expect(
      service(new StaleCatalog()).run(
        { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: message.id },
        confirm(convo.id),
      ),
    ).resolves.toBe('unavailable');

    expect(await ordersFor(convo.id)).toEqual([]);
    const row = await conversationRow(convo.id);
    expect(row.state).toBe('collecting_details');
    expect(readSlots(row.collectedSlots).items[0]).toMatchObject({ productId: lungi.productId });
    expect(readSlots(row.collectedSlots).items[0]?.variantId).toBeUndefined();
    const [variant] = await t.db
      .select()
      .from(schema.productVariant)
      .where(eq(schema.productVariant.id, lungi.variantId));
    expect(variant).toMatchObject({ stock: 1, reserved: 0 });
  });

  it('does not swallow a failure that is not about stock', async () => {
    const lungi = await product('Failing Lungi', 10_000, 5);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const message = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
    });

    await expect(
      service(new OrderCatalogRepository(), FailingOrders).run(
        { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: message.id },
        confirm(convo.id),
      ),
    ).rejects.toThrow('order write failed');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect((await conversationRow(convo.id)).state).toBe('awaiting_confirmation');
  });

  it('creates one assistant order with the card numbers, sends its reference, then emails', async () => {
    const lungi = await product('Confirm Lungi', 160_000);
    const kajal = await product('Confirm Kajal', 21_000);
    const convo = await shown([
      { ...lungi, quantity: 2 },
      { ...kajal, quantity: 1 },
    ]);

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('ordered');

    const [order] = await ordersFor(convo.id);
    expect(order).toMatchObject({
      source: 'assistant',
      status: 'new',
      conversationId: convo.id,
      idempotencyKey: `assistant:${convo.id}:1`,
      subtotal: 341_000,
      deliveryFee: 12_000,
      total: 353_000,
      customerName: 'Rahim',
      phone: '+8801812000000',
      deliveryAddress: 'Zindabazar, Sylhet',
      deliveryChargeId: fallbackA,
      deliveryEverywhereElse: true,
    });
    const items = await t.db
      .select()
      .from(schema.orderItem)
      .where(eq(schema.orderItem.orderId, order!.id));
    expect(items.map((item) => [item.variantId, item.quantity, item.unitPrice])).toEqual(
      expect.arrayContaining([
        [lungi.variantId, 2, 160_000],
        [kajal.variantId, 1, 21_000],
      ]),
    );
    expect((await conversationRow(convo.id)).state).toBe('confirmed');
    expect(sent).toEqual([
      {
        kind: 'text',
        text: confirmText({ kind: 'reference', reference: order!.reference }, 'bn'),
        payloads: [],
      },
    ]);
    expect(drafted).toEqual([{ orderId: order!.id, committed: true }]);
  });

  it('copies the conversation’s entry source onto an assistant order', async () => {
    const lungi = await product('Entry Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }], { entrySource: 'ad' });

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('ordered');

    const [order] = await ordersFor(convo.id);
    expect(order?.entrySource).toBe('ad');
  });

  it('answers a second tap with the same reference and no second order or email', async () => {
    const lungi = await product('Double Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);

    await tap(convo.id, confirm(convo.id));
    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('replayed');

    const orders = await ordersFor(convo.id);
    expect(orders).toHaveLength(1);
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'reference', reference: orders[0]!.reference }, 'bn'),
      confirmText({ kind: 'reference', reference: orders[0]!.reference }, 'bn'),
    ]);
    // The second call is a no-op: the queue's job id is per order.
    expect(drafted.map((entry) => entry.orderId)).toEqual([orders[0]!.id, orders[0]!.id]);
  });

  it('sends a second tap the reference though the chat moved on before its turn ran', async () => {
    const lungi = await product('Moved On Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    await tap(convo.id, confirm(convo.id));
    const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
    const second = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
      sentAt: later(1),
    });
    await seedMessage(t.db, t.merchantA, convo.id, { text: 'kobe pabo?', sentAt: later(2) });
    await seedMessage(t.db, t.merchantA, convo.id, {
      sender: 'assistant',
      text: 'Shop will call you soon.',
      sentAt: later(3),
    });

    await expect(
      service().run(
        { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: second.id },
        confirm(convo.id),
      ),
    ).resolves.toBe('replayed');

    const [order] = await ordersFor(convo.id);
    const reference = confirmText({ kind: 'reference', reference: order!.reference }, 'bn');
    expect(sent.map((entry) => entry.text)).toEqual([reference, reference]);
  });

  it('finishes a run whose email failed after commit: no second reference, the email queued', async () => {
    const lungi = await product('Retry Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const message = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
    });
    const job = { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: message.id };
    notifyFailures = 1;

    await expect(service().run(job, confirm(convo.id))).rejects.toThrow('queue down');
    await expect(service().run(job, confirm(convo.id))).resolves.toBe('replayed');

    const orders = await ordersFor(convo.id);
    expect(orders).toHaveLength(1);
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'reference', reference: orders[0]!.reference }, 'bn'),
    ]);
    expect(drafted).toEqual([{ orderId: orders[0]!.id, committed: true }]);
  });

  it.each([
    ['refused by Graph', 'failed'],
    ['lost to a crash before the send', 'sending'],
  ] as const)(
    'redelivers the stored reference when the first reply was %s',
    async (_case, leftAs) => {
      const lungi = await product(`Redeliver Lungi ${leftAs}`, 160_000);
      const convo = await shown([{ ...lungi, quantity: 1 }]);
      const message = await seedMessage(t.db, t.merchantA, convo.id, {
        text: 'Confirm',
        payload: `confirm:${convo.id}:1`,
      });
      const job = {
        merchantId: t.merchantA,
        conversationId: convo.id,
        triggerMessageId: message.id,
      };
      const replies = () =>
        t.db
          .select()
          .from(schema.message)
          .where(eq(schema.message.conversationId, convo.id))
          .then((rows) => rows.filter((row) => row.sender === 'assistant'));

      if (leftAs === 'failed') sendFailures = 1;
      else crashes = 1;
      await service()
        .run(job, confirm(convo.id))
        .catch(() => undefined);
      expect((await replies()).map((row) => row.status)).toEqual([leftAs]);
      expect(sent).toEqual([]);
      if (leftAs === 'sending') await outlived(convo.id);

      await expect(service().run(job, confirm(convo.id))).resolves.toBe('replayed');

      const orders = await ordersFor(convo.id);
      expect(orders).toHaveLength(1);
      const reference = confirmText({ kind: 'reference', reference: orders[0]!.reference }, 'bn');
      expect(sent.map((entry) => entry.text)).toEqual([reference]);
      expect((await replies()).map((row) => [row.text, row.status])).toEqual([[reference, 'sent']]);

      await expect(service().run(job, confirm(convo.id))).resolves.toBe('replayed');
      expect(sent).toHaveLength(1);
    },
  );

  it('retries, sending nothing, while another run holds the reference, then sends it once the lease ends', async () => {
    const lungi = await product('In Flight Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const message = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
    });
    const job = { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: message.id };
    crashes = 1;
    await expect(service().run(job, confirm(convo.id))).rejects.toThrow('worker died');

    await expect(service().run(job, confirm(convo.id))).rejects.toThrow(ReplyInFlightError);
    expect(sent).toEqual([]);

    await outlived(convo.id);
    await expect(service().run(job, confirm(convo.id))).resolves.toBe('replayed');
    const [order] = await ordersFor(convo.id);
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'reference', reference: order!.reference }, 'bn'),
    ]);
  });

  it('sends a stored reference once when two retries redeliver it at the same time', async () => {
    const lungi = await product('Redeliver Race Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const message = await seedMessage(t.db, t.merchantA, convo.id, {
      text: 'Confirm',
      payload: `confirm:${convo.id}:1`,
    });
    const job = { merchantId: t.merchantA, conversationId: convo.id, triggerMessageId: message.id };
    sendFailures = 1;
    await expect(service().run(job, confirm(convo.id))).resolves.toBe('send_failed');
    expect(sent).toEqual([]);

    let open!: () => void;
    const held = { waiting: 0, open: new Promise<void>((resolve) => (open = resolve)) };
    gate = held;
    const runs = [service().run(job, confirm(convo.id)), service().run(job, confirm(convo.id))];
    let settled = 0;
    for (const run of runs) void run.finally(() => (settled += 1)).catch(() => undefined);
    while (held.waiting + settled < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    open();
    const outcomes = await Promise.allSettled(runs);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(service().run(job, confirm(convo.id))).resolves.toBe('replayed');
    const [order] = await ordersFor(convo.id);
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'reference', reference: order!.reference }, 'bn'),
    ]);
  });

  it('creates one order when two taps race', async () => {
    const lungi = await product('Race Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);

    const outcomes = await Promise.all([
      tap(convo.id, confirm(convo.id)),
      tap(convo.id, confirm(convo.id)),
    ]);

    expect(outcomes.sort()).toEqual(['ordered', 'replayed']);
    const orders = await ordersFor(convo.id);
    expect(orders).toHaveLength(1);
    expect(new Set(drafted.map((entry) => entry.orderId))).toEqual(new Set([orders[0]!.id]));
  });

  it('refuses the Confirm of an older card', async () => {
    const lungi = await product('Stale Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }], {});
    await t.db
      .update(schema.conversation)
      .set({
        collectedSlots: {
          ...readSlots((await conversationRow(convo.id)).collectedSlots),
          revision: 2,
        },
      })
      .where(eq(schema.conversation.id, convo.id));

    await expect(tap(convo.id, confirm(convo.id, 1))).resolves.toBe('stale_card');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(sent.map((entry) => entry.text)).toEqual([confirmText({ kind: 'stale' }, 'bn')]);
    expect(drafted).toEqual([]);
  });

  it('refuses a card whose quote is still stored once the chat left awaiting confirmation', async () => {
    const lungi = await product('Asked Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }], { state: 'collecting_details' });

    await expect(tap(convo.id, confirm(convo.id, 1))).resolves.toBe('stale_card');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(drafted).toEqual([]);
  });

  it('refuses a Confirm at the current revision when the stored quote is older', async () => {
    const lungi = await product('Unquoted Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    await t.db
      .update(schema.conversation)
      .set({
        collectedSlots: {
          ...readSlots((await conversationRow(convo.id)).collectedSlots),
          revision: 2,
        },
      })
      .where(eq(schema.conversation.id, convo.id));

    await expect(tap(convo.id, confirm(convo.id, 2))).resolves.toBe('stale_card');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(drafted).toEqual([]);
  });

  it('does nothing while the seller holds the chat', async () => {
    const lungi = await product('Paused Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }], { botPaused: true });

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('ignored');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('refuses the card shown before a take-over once the seller hands the chat back', async () => {
    const lungi = await product('Handback Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    const conversations = new ConversationsService(
      runtime.db,
      new ConversationRepository(),
      new MessageRepository(),
      new FacebookPageRepository(),
      null,
      publisher,
      {} as unknown as OutboundMessageSender,
      new InMemoryObjectStorage(),
    );
    await conversations.update({ merchantId: t.merchantA }, convo.id, { botPaused: true });
    await conversations.update({ merchantId: t.merchantA }, convo.id, { botPaused: false });

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('stale_card');

    expect(await ordersFor(convo.id)).toEqual([]);
    const row = await conversationRow(convo.id);
    expect(row.state).toBe('collecting_details');
    expect(readSlots(row.collectedSlots)).toMatchObject({ revision: 2 });
    expect(readSlots(row.collectedSlots).quote).toBeUndefined();
    expect(drafted).toEqual([]);
  });

  it('does nothing for a button naming another conversation, or another merchant', async () => {
    const lungi = await product('Foreign Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const other = await shown([{ ...lungi, quantity: 1 }]);

    await expect(tap(convo.id, confirm(other.id))).resolves.toBe('ignored');
    await expect(tap(convo.id, confirm(convo.id), t.merchantB)).resolves.toBe('ignored');

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(await ordersFor(other.id)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('makes no order when a line was archived, re-asks that item and keeps the others', async () => {
    const a = await product('Archive A', 10_000);
    const b = await product('Archive B', 20_000);
    const c = await product('Archive C', 30_000);
    const convo = await shown([
      { ...a, quantity: 1 },
      { ...b, quantity: 1 },
      { ...c, quantity: 1 },
    ]);
    await t.db
      .update(schema.productVariant)
      .set({ archivedAt: new Date() })
      .where(eq(schema.productVariant.id, b.variantId));

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('unavailable');

    expect(await ordersFor(convo.id)).toEqual([]);
    const row = await conversationRow(convo.id);
    expect(row.state).toBe('collecting_details');
    const slots = readSlots(row.collectedSlots);
    expect(slots.revision).toBe(2);
    expect(slots.quote).toBeUndefined();
    expect(slots.items.map((item) => [item.productId, item.variantId])).toEqual([
      [a.productId, a.variantId],
      [b.productId, undefined],
      [c.productId, c.variantId],
    ]);
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'unavailable', name: 'Archive B' }, 'bn'),
    ]);
  });

  it('clears the product too when it left the sellable catalog, and refuses a short stock', async () => {
    const unlisted = await product('Drafted Lungi', 10_000);
    const short = await product('Short Lungi', 10_000, 1);
    const convo = await shown([
      { ...unlisted, quantity: 1 },
      { ...short, quantity: 2 },
    ]);
    await t.db
      .update(schema.product)
      .set({ status: 'draft' })
      .where(eq(schema.product.id, unlisted.productId));

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('unavailable');

    const slots = readSlots((await conversationRow(convo.id)).collectedSlots);
    expect(slots.items.map((item) => [item.productId, item.variantId])).toEqual([
      [undefined, undefined],
      [short.productId, undefined],
    ]);
    expect(await ordersFor(convo.id)).toEqual([]);
  });

  it('makes no order when a price changed, and sends a fresh card for the next revision', async () => {
    const lungi = await product('Price Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 2 }]);
    await t.db
      .update(schema.productVariant)
      .set({ price: 170_025 })
      .where(eq(schema.productVariant.id, lungi.variantId));

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('price_changed');

    expect(await ordersFor(convo.id)).toEqual([]);
    const row = await conversationRow(convo.id);
    expect(row.state).toBe('awaiting_confirmation');
    expect(readSlots(row.collectedSlots)).toMatchObject({
      revision: 2,
      quote: { revision: 2, subtotal: 340_050, total: 352_050 },
    });
    const [card] = sent;
    expect(card?.kind).toBe('card');
    // Paisa show only when there are some.
    expect(card?.text).toContain('৩,৪০০.৫০৳');
    expect(card?.text).toContain('১২০৳');
    expect(card?.text).toContain('৩,৫২০.৫০৳');
    expect(card?.text.startsWith(confirmText({ kind: 'price_changed' }, 'bn'))).toBe(true);
    expect(card?.payloads).toEqual([`confirm:${convo.id}:2`, `change:${convo.id}:2`]);

    await expect(tap(convo.id, confirm(convo.id, 2))).resolves.toBe('ordered');
    expect((await ordersFor(convo.id))[0]).toMatchObject({ subtotal: 340_050 });
  });

  it('makes no order when the shop changed its currency, and sends a fresh card in the new one', async () => {
    const lungi = await product('Currency Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);
    const shopIn = (currency: string) =>
      t.db
        .insert(schema.merchantSettings)
        .values({
          merchantId: t.merchantA,
          country: 'BD',
          currency,
          timeZone: 'Asia/Dhaka',
          dateFormat: 'dd/MM/yyyy',
        })
        .onConflictDoUpdate({ target: schema.merchantSettings.merchantId, set: { currency } });
    await shopIn('USD');
    try {
      await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('price_changed');
    } finally {
      await shopIn('BDT');
    }

    expect(await ordersFor(convo.id)).toEqual([]);
    expect(readSlots((await conversationRow(convo.id)).collectedSlots)).toMatchObject({
      revision: 2,
      quote: { revision: 2, currency: 'USD', total: 172_000 },
    });
    expect(sent.map((entry) => entry.kind)).toEqual(['card']);
    expect(sent[0]?.payloads).toEqual([`confirm:${convo.id}:2`, `change:${convo.id}:2`]);
  });

  it('makes no order when only the delivery fee changed: the area charge, or the free-delivery threshold', async () => {
    const lungi = await product('Fee Lungi', 160_000);
    const setCharge = (charge: number) =>
      t.db
        .update(schema.deliveryCharge)
        .set({ charge })
        .where(eq(schema.deliveryCharge.id, fallbackA));
    const setThreshold = (freeDeliveryOver: number | null) =>
      t.db
        .insert(schema.merchantSettings)
        .values({
          merchantId: t.merchantA,
          country: 'BD',
          currency: 'BDT',
          timeZone: 'Asia/Dhaka',
          dateFormat: 'dd/MM/yyyy',
          freeDeliveryOver,
        })
        .onConflictDoUpdate({
          target: schema.merchantSettings.merchantId,
          set: { freeDeliveryOver },
        });

    const charged = await shown([{ ...lungi, quantity: 1 }]);
    await setCharge(15_000);
    try {
      await expect(tap(charged.id, confirm(charged.id))).resolves.toBe('price_changed');
    } finally {
      await setCharge(12_000);
    }
    expect(readSlots((await conversationRow(charged.id)).collectedSlots).quote).toMatchObject({
      revision: 2,
      deliveryFee: 15_000,
      total: 175_000,
    });

    const free = await shown([{ ...lungi, quantity: 1 }]);
    await setThreshold(100_000);
    try {
      await expect(tap(free.id, confirm(free.id))).resolves.toBe('price_changed');
    } finally {
      await setThreshold(null);
    }
    expect(readSlots((await conversationRow(free.id)).collectedSlots).quote).toMatchObject({
      revision: 2,
      deliveryFee: 0,
      total: 160_000,
    });
    expect(await ordersFor(charged.id)).toEqual([]);
    expect(await ordersFor(free.id)).toEqual([]);
  });

  it('goes back to collecting on Change, and refuses the old card afterwards', async () => {
    const lungi = await product('Change Lungi', 160_000);
    const convo = await shown([{ ...lungi, quantity: 1 }]);

    await expect(
      tap(convo.id, { kind: 'change', conversationId: convo.id, revision: 1 }),
    ).resolves.toBe('changing');

    const row = await conversationRow(convo.id);
    expect(row.state).toBe('collecting_details');
    expect(readSlots(row.collectedSlots).revision).toBe(2);
    await expect(tap(convo.id, confirm(convo.id, 1))).resolves.toBe('stale_card');
    expect(sent.map((entry) => entry.text)).toEqual([
      confirmText({ kind: 'change' }, 'bn'),
      confirmText({ kind: 'stale' }, 'bn'),
    ]);
    expect(await ordersFor(convo.id)).toEqual([]);
  });
});

describeDb('the assistant quote and POST /orders/delivery-quote', () => {
  let t: CatalogTestDb;

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it('charges the same fee for the same items and area, threshold included', async () => {
    const [dhaka, elsewhere] = await t.db
      .insert(schema.deliveryCharge)
      .values([
        { merchantId: t.merchantA, areaName: 'Dhaka', charge: 6_000, position: 0 },
        { merchantId: t.merchantA, areaName: null, isFallback: true, charge: 12_000, position: 1 },
      ])
      .returning();
    const products = productsService(t.db);
    const make = (name: string, price: number, charge: number) =>
      products.create(
        t.merchantA,
        createProductSchema.parse({
          name,
          status: 'active',
          customDelivery: true,
          deliveryCharges: [{ deliveryChargeId: dhaka!.id, charge }],
          variants: [{ price, stock: 10 }],
        }),
      );
    const heavy = await make('Parity Heavy', 50_000, 9_000);
    const light = await make('Parity Light', 20_000, 7_000);
    const settings = new MerchantSettingsRepository();
    const charges = new DeliveryChargesRepository();
    const quotes = new DeliveryQuoteService(
      t.db,
      charges,
      new ProductDeliveryRepository(),
      new OrderCatalogRepository(),
      settings,
    );
    const catalog = await products.findSellableCatalog(t.merchantA);
    const items = [
      { productId: heavy.id, variantId: heavy.variants[0]!.id, quantity: 1 },
      { productId: light.id, variantId: light.variants[0]!.id, quantity: 3 },
    ];

    for (const [area, freeDeliveryOver] of [
      [dhaka!, null],
      [elsewhere!, null],
      [dhaka!, 110_000],
    ] as const) {
      const delivery: DeliveryView = {
        areas: [{ id: dhaka!.id, areaName: 'Dhaka', charge: 6_000 }],
        fallback: { id: elsewhere!.id, areaName: null, charge: 12_000 },
        freeDeliveryOver,
        currency: 'BDT',
      };
      await t.db
        .insert(schema.merchantSettings)
        .values({
          merchantId: t.merchantA,
          country: 'BD',
          currency: 'BDT',
          timeZone: 'Asia/Dhaka',
          dateFormat: 'dd/MM/yyyy',
          freeDeliveryOver,
        })
        .onConflictDoUpdate({
          target: schema.merchantSettings.merchantId,
          set: { freeDeliveryOver },
        });
      const card = quoteFor(
        { ...emptySlots(), items, deliveryChargeId: area.id },
        catalog,
        delivery,
        1,
      );
      const dashboard = await quotes.quote(
        { merchantId: t.merchantA },
        {
          deliveryChargeId: area.id,
          items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        },
      );
      expect(card.deliveryFee).toBe(dashboard.fee);
      expect(card.subtotal).toBe(dashboard.subtotal);
    }
    expect(
      quoteFor(
        { ...emptySlots(), items, deliveryChargeId: dhaka!.id },
        catalog,
        {
          areas: [{ id: dhaka!.id, areaName: 'Dhaka', charge: 6_000 }],
          fallback: null,
          freeDeliveryOver: null,
          currency: 'BDT',
        },
        1,
      ).deliveryFee,
    ).toBe(9_000);
  });
});
