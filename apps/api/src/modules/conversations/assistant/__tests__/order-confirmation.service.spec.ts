import { Logger } from '@nestjs/common';
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
import { MessageRepository } from '../../message.repository';
import { OutboundMessageSender } from '../../outbound-message.sender';
import { confirmText } from '../assistant-fallbacks';
import { quoteFor, readSlots, type DeliveryView } from '../conversation-machine';
import { OrderConfirmationService, type CardTap } from '../order-confirmation.service';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as AppConfig);
let nextMid = 1;

describeDb('OrderConfirmationService (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;
  let pageA: string;
  let fallbackA: string;
  let sent: { kind: string; text: string; payloads: string[] }[];
  let drafted: { orderId: string; committed: boolean }[];
  let notifyFailures: number;

  const send =
    (kind: string) =>
    async (_token: string, _psid: string, text: string, options: GraphOption[] = []) => {
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

  const service = () => {
    const publisher = { publish: async () => undefined } as unknown as ConversationEventsPublisher;
    const catalog = new OrderCatalogRepository();
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
      new OrdersService(
        runtime.db,
        orders,
        new OrderEventsRepository(),
        catalog,
        settings,
        charges,
      ),
      new DeliveryQuoteService(
        runtime.db,
        charges,
        new ProductDeliveryRepository(),
        catalog,
        settings,
      ),
      new OutboundMessageSender(
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
  });
  afterAll(async () => {
    await runtime.close();
    await t.close();
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
      .set({ price: 170_000 })
      .where(eq(schema.productVariant.id, lungi.variantId));

    await expect(tap(convo.id, confirm(convo.id))).resolves.toBe('price_changed');

    expect(await ordersFor(convo.id)).toEqual([]);
    const row = await conversationRow(convo.id);
    expect(row.state).toBe('awaiting_confirmation');
    expect(readSlots(row.collectedSlots)).toMatchObject({
      revision: 2,
      quote: { revision: 2, subtotal: 340_000, total: 352_000 },
    });
    const [card] = sent;
    expect(card?.kind).toBe('card');
    expect(card?.text.startsWith(confirmText({ kind: 'price_changed' }, 'bn'))).toBe(true);
    expect(card?.payloads).toEqual([`confirm:${convo.id}:2`, `change:${convo.id}:2`]);

    await expect(tap(convo.id, confirm(convo.id, 2))).resolves.toBe('ordered');
    expect((await ordersFor(convo.id))[0]).toMatchObject({ subtotal: 340_000 });
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
