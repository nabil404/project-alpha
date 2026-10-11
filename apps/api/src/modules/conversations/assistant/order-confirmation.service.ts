import { Inject, Injectable } from '@nestjs/common';
import {
  formatMinorUnitsTrimmed,
  type AssistantPayload,
  type CollectedSlots,
  type Quote,
} from '@app/shared';
import type { Executor, TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import type { ConversationRow, MessageRow } from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import { DeliveryQuoteService } from '../../orders/delivery-quote.service';
import {
  OrderCatalogRepository,
  type OrderableVariant,
} from '../../orders/order-catalog.repository';
import { OrdersRepository } from '../../orders/orders.repository';
import { OrdersService } from '../../orders/orders.service';
import type { AssistantTurnJob } from '../../queue/queue.constants';
import { DeliveryChargesRepository } from '../../settings/delivery-charges.repository';
import { defaultMerchantSettings } from '../../settings/general-settings.service';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { ConversationRepository } from '../conversation.repository';
import { MessageRepository } from '../message.repository';
import { OutboundMessageSender } from '../outbound-message.sender';
import { confirmText, languageFor, type ReplyLanguage } from './assistant-fallbacks';
import { LOCALES, readSlots } from './conversation-machine';
import { outgoingFor, type Outgoing } from './outgoing';
import type { ReplyFacts } from './reply-intent';

/** A tap on the summary card's Confirm or Change. */
export type CardTap = Extract<AssistantPayload, { kind: 'confirm' | 'change' }>;

export type ConfirmOutcome =
  | 'ordered'
  | 'replayed'
  | 'changing'
  | 'stale_card'
  | 'unavailable'
  | 'price_changed'
  | 'ignored'
  | 'send_failed';

/** The key that makes one card's Confirm create at most one order. */
export function confirmKey(conversationId: string, revision: number): string {
  return `assistant:${conversationId}:${revision}`;
}

interface Decided {
  outcome: Exclude<ConfirmOutcome, 'ignored' | 'send_failed'>;
  slots?: CollectedSlots;
  state?: 'collecting_details' | 'awaiting_confirmation' | 'confirmed';
  outgoing: Outgoing[];
  /** Replies an earlier run of this job stored but never got out, sent again as they are. */
  redeliver?: MessageRow[];
  /** The card's order, made by this run or found from an earlier one. */
  orderId?: string;
}

/**
 * The summary card's buttons (P10: no LLM on this path). One short
 * transaction locks the conversation, re-reads every line's variant and the
 * delivery fee, and either creates the order with the card's numbers or says
 * why not; the reply is staged in it and sent after commit, and the seller is
 * emailed only when this run created the order. The idempotency key per card
 * revision makes a second tap find the first order and resend its reference.
 */
@Injectable()
export class OrderConfirmationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly deliveryCharges: DeliveryChargesRepository,
    private readonly catalog: OrderCatalogRepository,
    private readonly orders: OrdersRepository,
    private readonly ordersService: OrdersService,
    private readonly deliveryQuote: DeliveryQuoteService,
    private readonly outbound: OutboundMessageSender,
    private readonly notifications: NotificationsService,
  ) {}

  async run(
    { merchantId, conversationId, triggerMessageId }: AssistantTurnJob,
    tap: CardTap,
  ): Promise<ConfirmOutcome> {
    const scope: TenantScope = { merchantId };
    if (tap.conversationId !== conversationId) return 'ignored';

    const staged = await withMerchant(this.db, merchantId, async (tx) => {
      const locked = await this.conversations.findById(tx, scope, conversationId, { lock: true });
      if (!locked || locked.conversation.botPaused) return null;
      const page = await this.pages.findForMerchant(tx, scope);
      if (!page || page.pageId !== locked.conversation.facebookPageId) return null;
      const settings = (await this.settings.find(tx, scope)) ?? defaultMerchantSettings();
      const language = languageFor(settings.country);
      const slots = readSlots(locked.conversation.collectedSlots);
      const recent = await this.messages.listPage(tx, scope, conversationId, { limit: 20 });
      const trigger = recent.find((message) => message.id === triggerMessageId);
      const replies = trigger ? repliesTo(recent, trigger) : [];

      const decided =
        tap.kind === 'change'
          ? this.change(locked.conversation, slots, tap, language)
          : await this.confirm(tx, scope, locked.conversation, slots, tap, {
              language,
              currency: settings.currency,
              replies,
            });

      // The reply must sort after its tap even when Meta's clock runs ahead of ours.
      const now = new Date(Math.max(Date.now(), (trigger?.sentAt.getTime() ?? 0) + 1));
      let conversation = locked.conversation;
      if (decided.slots || decided.state) {
        conversation =
          (await this.conversations.update(tx, scope, conversationId, {
            ...(decided.state ? { state: decided.state } : {}),
            ...(decided.slots ? { collectedSlots: decided.slots } : {}),
          })) ?? conversation;
      }
      const rows: MessageRow[] = [];
      for (const [index, message] of decided.outgoing.entries()) {
        rows.push(
          await this.outbound.stage(tx, scope, conversation, {
            sender: 'assistant',
            text: message.text,
            now: new Date(now.getTime() + index),
          }),
        );
      }
      const sends = [
        ...(decided.redeliver ?? []).map((row) => ({ row, content: TEXT })),
        ...rows.map((row, index) => ({ row, content: decided.outgoing[index]!.content })),
      ];
      return { decided, sends, psid: locked.customer.psid, token: page.accessToken };
    });
    if (!staged) return 'ignored';

    let delivered = true;
    for (const { row, content } of staged.sends) {
      if (!delivered) {
        await this.outbound.abandon(scope, row);
        continue;
      }
      const final = await this.outbound.deliver(scope, {
        row,
        psid: staged.psid,
        encryptedToken: staged.token,
        content,
      });
      delivered = final.status !== 'failed';
    }
    if (staged.decided.orderId) {
      // Also for a replay: a retry whose first run committed but never queued
      // the email. The job id is per order, so a second call is a no-op.
      await this.notifications.orderDrafted(merchantId, staged.decided.orderId);
    }
    return delivered ? staged.decided.outcome : 'send_failed';
  }

  /** Back to collecting on the card it was shown on; any other card is stale. */
  private change(
    conversation: ConversationRow,
    slots: CollectedSlots,
    tap: CardTap,
    language: ReplyLanguage,
  ): Decided {
    if (conversation.state !== 'awaiting_confirmation' || tap.revision !== slots.revision) {
      return stale(language);
    }
    return {
      outcome: 'changing',
      state: 'collecting_details',
      slots: { ...slots, revision: slots.revision + 1, quote: undefined, lastAsked: undefined },
      outgoing: [text(confirmText({ kind: 'change' }, language))],
    };
  }

  private async confirm(
    tx: Executor,
    scope: TenantScope,
    conversation: ConversationRow,
    slots: CollectedSlots,
    tap: CardTap,
    {
      language,
      currency,
      replies,
    }: { language: ReplyLanguage; currency: string; replies: MessageRow[] },
  ): Promise<Decided> {
    const key = confirmKey(conversation.id, tap.revision);
    const existing = await this.orders.findByIdempotencyKey(tx, scope, key);
    if (existing) {
      // A retry of the run that made it finds its reply already stored: done
      // once sent, else sent again from the stored row by the one run that
      // claims it. A second tap is a new trigger and gets the reference again.
      if (replies.some((reply) => reply.status === 'sent')) {
        return { outcome: 'replayed', orderId: existing.id, outgoing: [] };
      }
      if (replies.length > 0) {
        const redeliver: MessageRow[] = [];
        for (const reply of replies) {
          const claimed = await this.messages.claimForResend(tx, scope, reply.id);
          if (claimed) redeliver.push(claimed);
        }
        return { outcome: 'replayed', orderId: existing.id, outgoing: [], redeliver };
      }
      return {
        outcome: 'replayed',
        orderId: existing.id,
        outgoing: [
          text(confirmText({ kind: 'reference', reference: existing.reference }, language)),
        ],
      };
    }
    const quote = slots.quote;
    if (
      conversation.state !== 'awaiting_confirmation' ||
      tap.revision !== slots.revision ||
      !quote ||
      quote.revision !== slots.revision
    ) {
      return stale(language);
    }

    const variants = await this.catalog.findVariants(
      tx,
      scope,
      quote.lines.map((line) => line.variantId),
    );
    const wanted = new Map<string, number>();
    for (const line of quote.lines) {
      wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
    }
    const gone = quote.lines.filter((line) => {
      const variant = variants.get(line.variantId);
      return (
        !variant ||
        !variant.live ||
        !variant.productActive ||
        variant.stock < wanted.get(line.variantId)!
      );
    });
    if (gone.length > 0) return unavailable(slots, gone, variants, language);

    const area = await this.deliveryCharges.find(tx, scope, quote.deliveryChargeId);
    if (!area) {
      return {
        ...stale(language),
        state: 'collecting_details',
        slots: {
          ...slots,
          deliveryChargeId: undefined,
          quote: undefined,
          revision: slots.revision + 1,
        },
      };
    }
    const lines = quote.lines.map((line) => {
      const price = variants.get(line.variantId)!.price;
      return { ...line, unitPrice: price, lineTotal: price * line.quantity };
    });
    const fee = await this.deliveryQuote.feeFor(tx, scope, area.id, lines);
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const changed =
      currency !== quote.currency ||
      fee.fee !== quote.deliveryFee ||
      lines.some((line, index) => line.unitPrice !== quote.lines[index]!.unitPrice);
    if (changed) {
      const revision = slots.revision + 1;
      const fresh: Quote = {
        ...quote,
        currency,
        revision,
        lines,
        subtotal,
        deliveryFee: fee.fee,
        total: subtotal + fee.fee,
      };
      const next: CollectedSlots = { ...slots, revision, quote: fresh };
      return {
        outcome: 'price_changed',
        slots: next,
        outgoing: outgoingFor(
          {
            kind: 'summary',
            quote: fresh,
            facts: cardFacts(next, fresh, variants, area.areaName, language),
          },
          '',
          {
            language,
            conversationId: conversation.id,
            notice: confirmText({ kind: 'price_changed' }, language),
          },
        ),
      };
    }

    const { order, created } = await this.ordersService.createInTransaction(
      tx,
      scope,
      null,
      {
        customerId: conversation.customerId,
        items: quote.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
        deliveryFee: quote.deliveryFee,
        deliveryChargeId: quote.deliveryChargeId,
        customerName: slots.customerName,
        phone: slots.phone,
        deliveryAddress: slots.deliveryAddress,
        paymentMethod: 'cash_on_delivery',
      },
      key,
      { source: 'assistant', conversationId: conversation.id },
    );
    return {
      outcome: created ? 'ordered' : 'replayed',
      state: 'confirmed',
      slots: { ...slots, lastAsked: undefined, offered: undefined },
      outgoing: [text(confirmText({ kind: 'reference', reference: order.reference }, language))],
      orderId: order.id,
    };
  }
}

const TEXT = { kind: 'text' } as const;
const text = (value: string): Outgoing => ({ text: value, content: TEXT });

/** The assistant's replies to a tap: after it, up to the customer's next message, oldest first. */
function repliesTo(newestFirst: MessageRow[], trigger: MessageRow): MessageRow[] {
  const replies: MessageRow[] = [];
  for (const message of newestFirst.filter((row) => row.sentAt > trigger.sentAt).reverse()) {
    if (message.sender === 'customer') break;
    if (message.sender === 'assistant') replies.push(message);
  }
  return replies;
}

function stale(language: ReplyLanguage): Decided {
  return { outcome: 'stale_card', outgoing: [text(confirmText({ kind: 'stale' }, language))] };
}

/**
 * P11: lines whose variant was archived, left the sellable catalog, or ran
 * short lose their variant (and their product when it is no longer sold);
 * the other items stay, and the customer is asked again.
 */
function unavailable(
  slots: CollectedSlots,
  gone: Quote['lines'],
  variants: Map<string, OrderableVariant>,
  language: ReplyLanguage,
): Decided {
  const goneIds = new Set(gone.map((line) => line.variantId));
  const items = slots.items.map((item) => {
    if (item.variantId === undefined || !goneIds.has(item.variantId)) return item;
    const variant = variants.get(item.variantId);
    const { variantId: _variantId, ...rest } = item;
    if (variant?.productActive) return rest;
    const { productId: _productId, ...withoutProduct } = rest;
    return withoutProduct;
  });
  const first = variants.get(gone[0]!.variantId);
  const name = first
    ? [first.productName, first.variantName].filter(Boolean).join(', ')
    : (slots.items.find((item) => item.variantId === gone[0]!.variantId)?.productQuery ?? '');
  return {
    outcome: 'unavailable',
    state: 'collecting_details',
    slots: {
      ...slots,
      items,
      revision: slots.revision + 1,
      quote: undefined,
      lastAsked: undefined,
    },
    outgoing: [text(confirmText({ kind: 'unavailable', name }, language))],
  };
}

/** The facts a fresh card shows, from the variants just re-read. */
function cardFacts(
  slots: CollectedSlots,
  quote: Quote,
  variants: Map<string, OrderableVariant>,
  areaName: string | null,
  language: ReplyLanguage,
): ReplyFacts {
  const money = (amount: number) =>
    formatMinorUnitsTrimmed(amount, quote.currency, LOCALES[language]);
  return {
    items: quote.lines.map((line) => {
      const variant = variants.get(line.variantId)!;
      return {
        productName: variant.productName,
        ...(variant.variantName ? { variantName: variant.variantName } : {}),
        quantity: line.quantity,
        unitPrice: money(line.unitPrice),
        lineTotal: money(line.lineTotal),
      };
    }),
    ...(slots.customerName ? { customerName: slots.customerName } : {}),
    ...(slots.phone ? { phone: slots.phone } : {}),
    ...(slots.deliveryAddress ? { deliveryAddress: slots.deliveryAddress } : {}),
    ...(areaName ? { areaName } : {}),
    subtotal: money(quote.subtotal),
    deliveryFee: money(quote.deliveryFee),
    total: money(quote.total),
  };
}
