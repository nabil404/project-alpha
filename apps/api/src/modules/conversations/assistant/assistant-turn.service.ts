import { Inject, Injectable } from '@nestjs/common';
import {
  formatMinorUnitsTrimmed,
  parsePayload,
  type AssistantPayload,
  type CollectedSlots,
  type ProductVia,
} from '@app/shared';
import { OrdersRepository } from '../../orders/orders.repository';
import { ProductsService } from '../../products/products.service';
import {
  DeliveryChargesRepository,
  type DeliveryChargeRow,
} from '../../settings/delivery-charges.repository';
import { AssistantSettingsService } from '../../settings/assistant-settings.service';
import { defaultMerchantSettings } from '../../settings/general-settings.service';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import {
  LLM,
  type ChatLine,
  type ExtractionContext,
  type LlmCallRecord,
  type LlmClient,
  type LlmResult,
  type PhraseRequest,
} from '../../llm/llm.types';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import {
  ProductPostRepository,
  type PostDetails,
} from '../../messenger/posts/product-post.repository';
import { SharedPostResolver } from '../../messenger/posts/shared-post.resolver';
import { NotificationsService } from '../../notifications/notifications.service';
import type { AssistantTurnJob, SharedLink } from '../../queue/queue.constants';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { ConversationRepository } from '../conversation.repository';
import { isReplyWindowOpen } from '../conversation-rules';
import { MessageRepository } from '../message.repository';
import { OutboundMessageSender, type OutboundContent } from '../outbound-message.sender';
import type { MessageRow } from '../../database/schema/index';
import { fallbackText, languageFor, type ReplyLanguage } from './assistant-fallbacks';
import { toChatLines } from './assistant-history';
import { matchProduct, type CatalogView } from './catalog-match';
import {
  decideNotIt,
  decidePhoto,
  decideSharedPost,
  decideTurn,
  handOff,
  isActiveState,
  LOCALES,
  readSlots,
  shouldExtract,
  validNameTap,
  validPick,
  type DeliveryView,
  type Entry,
  type ItemPick,
  type TurnInput,
  type TurnDecision,
} from './conversation-machine';
import { LlmCallRepository } from './llm-call.repository';
import { checkReply } from './reply-check';
import type { LastOrderFacts, ReplyIntent } from './reply-intent';
import { OrderConfirmationService, type ConfirmOutcome } from './order-confirmation.service';
import { outgoingFor } from './outgoing';
import { phraseRequestFor, phraseVoice } from './reply-phrasing';
import { askedAt, turnGate, type TurnGate } from './turn-gate';
import { decideNonText } from './non-text-turn';
import {
  matchedProductIds,
  MAX_PHOTOS_PER_TURN,
  photoMatchRequest,
  photosIn,
  photoShortlist,
  VISION_CALLS_PER_DAY,
} from './photo-turn';
import { isEmojiOnly, readDetails } from '../message-content';
import { CustomerPhotoStore } from '../photos/customer-photo.store';

/** Messages read for a turn; the phrasing call sees the last PHRASE_HISTORY of them. */
const HISTORY_LIMIT = 20;
const PHRASE_HISTORY = 6;

export type TurnOutcome =
  | 'replied'
  | 'handed_off'
  | 'send_failed'
  | 'window_closed'
  | 'no_page'
  /** A reaction that asked nothing: no reply. */
  | 'silent'
  | Exclude<TurnGate, 'go'>
  | ConfirmOutcome;

/**
 * One assistant turn, per invariant #1: read, call the LLM with no transaction
 * open, then lock, re-check and write in one short transaction, and call Graph
 * after commit. LLM and Graph failures end in a hand-off with a fixed reply.
 * Database and Redis errors throw for BullMQ to retry, which the gate's
 * "answered" check makes safe.
 */
@Injectable()
export class AssistantTurnService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly pages: FacebookPageRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly deliveryCharges: DeliveryChargesRepository,
    private readonly products: ProductsService,
    private readonly llmCalls: LlmCallRepository,
    @Inject(LLM) private readonly llm: LlmClient | null,
    private readonly outbound: OutboundMessageSender,
    private readonly notifications: NotificationsService,
    private readonly confirmation: OrderConfirmationService,
    private readonly orders: OrdersRepository,
    private readonly sharedPosts: SharedPostResolver,
    private readonly productPosts: ProductPostRepository,
    private readonly photos: CustomerPhotoStore,
    private readonly assistantSettings: AssistantSettingsService,
  ) {}

  async run({
    merchantId,
    conversationId,
    triggerMessageId,
  }: AssistantTurnJob): Promise<TurnOutcome> {
    const scope: TenantScope = { merchantId };

    // 1. Read.
    const read = await withMerchant(this.db, merchantId, async (tx) => {
      const found = await this.conversations.findById(tx, scope, conversationId);
      if (!found) return null;
      const settings = (await this.settings.find(tx, scope)) ?? defaultMerchantSettings();
      const recent = await this.messages.listPage(tx, scope, conversationId, {
        limit: HISTORY_LIMIT,
      });
      const lastOrder =
        entryIn(tapIn(recent, triggerMessageId))?.kind === 'last_order'
          ? await this.orders.latestForCustomer(tx, scope, found.conversation.customerId)
          : null;
      return {
        ...found,
        lastOrder,
        recent,
        page: await this.pages.findForMerchant(tx, scope),
        country: settings.country,
        assistant: await this.assistantSettings.read(tx, scope),
        delivery: deliveryView(await this.deliveryCharges.list(tx, scope), settings),
      };
    });
    if (!read) return 'stale';
    const tap = tapIn(read.recent, triggerMessageId);
    if (tap?.kind === 'confirm' || tap?.kind === 'change') {
      return this.confirmation.run({ merchantId, conversationId, triggerMessageId }, tap);
    }
    const gate = turnGate(read.conversation, read.recent, triggerMessageId);
    if (gate === 'closed' || gate === 'answered') {
      return (await this.resume(scope, conversationId, read, triggerMessageId, gate)) ?? gate;
    }
    if (gate !== 'go') return gate;
    const state = read.conversation.state;
    if (!isActiveState(state)) return 'closed';
    const page = read.page;
    if (!page || page.pageId !== read.conversation.facebookPageId) return 'no_page';

    // 2. Think, with no transaction open. A tapped candidate or name needs no LLM.
    const catalog = await this.products.findSellableCatalog(merchantId);
    const calls: LlmCallRecord[] = [];
    const history = toChatLines(read.recent);
    const language = languageFor(read.country);
    const turn = {
      state,
      slots: readSlots(read.conversation.collectedSlots),
      country: read.country,
      language,
      catalog,
      delivery: read.delivery,
      profileName: read.customer.name,
    };
    const nonText = nonTextIn(read.recent, triggerMessageId, turn);
    if (nonText === 'silent') return 'silent';
    const pick = pickIn(read.recent, triggerMessageId, turn.slots);
    const name = tap?.kind === 'name' ? validNameTap(turn.slots) : null;
    let entry = entryIn(tap);
    const notIt = tap?.kind === 'not_it' ? decideNotIt(turn) : null;
    // A shared post resolves, most exact first, before any LLM call (phase 5).
    const share =
      nonText || pick || name || entry || notIt ? null : shareIn(read.recent, triggerMessageId);
    let shareDecision: TurnDecision | null = null;
    let suggestion: { productId: string; post: PostDetails } | null = null;
    if (share) {
      const shared = await this.sharedPosts.resolve(scope, share.links, page);
      if (shared.kind === 'product') {
        entry = {
          kind: 'product',
          productId: shared.productId,
          via: share.typed ? 'ref-typed' : 'ref',
        };
      } else {
        const candidates =
          shared.kind === 'suggested'
            ? [shared.productId]
            : shared.kind === 'caption'
              ? captionCandidates(shared.caption, catalog)
              : [];
        shareDecision = decideSharedPost(turn, candidates);
        const offered = shareDecision.reply.kind === 'ask_slot' ? shareDecision.reply.choices : [];
        if (shared.kind === 'caption' && candidates.length === 1 && offered?.length === 1) {
          suggestion = { productId: candidates[0]!, post: shared.post };
        }
      }
    }
    // A photo is matched to the catalog by the vision call, and only ever suggested (phase 6).
    const photos =
      nonText || pick || name || entry || notIt || share
        ? null
        : photosIn(read.recent, triggerMessageId);
    const photoDecision = photos
      ? await this.readPhotos(scope, conversationId, photos, turn, calls)
      : null;
    // A ref that arrived with words of the customer's own is a message with a product attached.
    const typedRef = entry?.kind === 'product' && entry.via === 'ref-typed';
    let decision: TurnDecision;
    let phrased = false;
    if (nonText) {
      decision = nonText;
    } else if (notIt) {
      decision = notIt;
    } else if (shareDecision) {
      decision = shareDecision;
    } else if (photoDecision) {
      decision = photoDecision;
    } else if (pick) {
      decision = decideTurn({ ...turn, trigger: { kind: 'pick', pick } });
    } else if (name !== null) {
      decision = decideTurn({ ...turn, trigger: { kind: 'name', name } });
    } else if (entry && !typedRef) {
      const trigger = { kind: 'entry' as const, entry: toEntry(entry, read.lastOrder, language) };
      decision = decideTurn({ ...turn, trigger });
    } else if (entry?.kind === 'product') {
      const added = decideTurn({
        ...turn,
        trigger: { kind: 'entry', entry: { kind: 'product', productId: entry.productId } },
      });
      if (added.reply.kind === 'handoff') {
        // No room for the product (R10): the seller answers, whatever the words said.
        decision = added;
      } else {
        const answered = await this.decide({ ...turn, slots: added.slots }, history, calls);
        decision =
          answered.image === undefined && answered.reply.kind !== 'handoff' && added.image
            ? { ...answered, image: added.image }
            : answered;
        phrased = true;
      }
    } else {
      decision = await this.decide(turn, history, calls);
      phrased = true;
    }
    const text = phrased
      ? await this.words(
          decision.reply,
          history,
          language,
          phraseVoice(read.assistant, language),
          calls,
        )
      : fallbackText(decision.reply, language);
    const outgoing = outgoingFor(decision.reply, text, { language, conversationId });

    // 3. Re-check under the lock and write.
    const staged = await withMerchant(this.db, merchantId, async (tx) => {
      const locked = await this.conversations.findById(tx, scope, conversationId, { lock: true });
      if (!locked) return { outcome: 'stale' as const };
      await this.llmCalls.insertMany(tx, scope, conversationId, calls);
      if (suggestion) {
        await this.productPosts.suggest(tx, scope, suggestion.productId, suggestion.post);
      }
      const recent = await this.messages.listPage(tx, scope, conversationId, {
        limit: HISTORY_LIMIT,
      });
      const recheck = turnGate(locked.conversation, recent, triggerMessageId);
      if (recheck !== 'go') return { outcome: recheck };
      // The reply must sort after its trigger even when Meta's clock runs ahead of ours.
      const trigger = recent.find((message) => message.id === triggerMessageId);
      const now = new Date(Math.max(Date.now(), (trigger ? askedAt(trigger).getTime() : 0) + 1));
      if (!isReplyWindowOpen(locked.conversation.lastInboundAt, now))
        return { outcome: 'window_closed' as const };

      const handedOffAt = decision.reply.kind === 'handoff' ? now : null;
      const updated = await this.conversations.update(tx, scope, conversationId, {
        state: decision.state,
        collectedSlots: decision.slots,
        ...(handedOffAt ? { handedOffAt } : {}),
      });
      if (!updated) return { outcome: 'stale' as const };
      const rows = [];
      for (const [index, message] of outgoing.entries()) {
        const sentAt = new Date(now.getTime() + index);
        rows.push(
          await this.outbound.stage(tx, scope, updated, {
            sender: 'assistant',
            text: message.text,
            now: sentAt,
          }),
        );
      }
      return { outcome: 'go' as const, rows, psid: locked.customer.psid, handedOffAt, now };
    });
    if (staged.outcome !== 'go') return staged.outcome;

    // 4. Send after commit: the photo first, best effort, then each message in order.
    if (decision.image && decision.reply.kind !== 'handoff') {
      await this.outbound.deliverImage(staged.psid, page.accessToken, decision.image);
    }
    const delivered = await this.deliverInOrder(
      scope,
      staged.rows.map((row, index) => ({ row, content: outgoing[index]!.content })),
      staged.psid,
      page.accessToken,
    );
    let handedOffAt = staged.handedOffAt;
    if (!delivered && !handedOffAt) {
      handedOffAt = await this.handOffAfterFailedSend(scope, conversationId, staged.now);
    }
    if (handedOffAt) await this.notifications.handedOff(merchantId, conversationId, handedOffAt);
    if (!delivered) return 'send_failed';
    return handedOffAt ? 'handed_off' : 'replied';
  }

  /** Sends each staged row in turn; after a refused one the rest are marked failed unsent. */
  private async deliverInOrder(
    scope: TenantScope,
    messages: { row: MessageRow; content: OutboundContent }[],
    psid: string,
    encryptedToken: string,
  ): Promise<boolean> {
    let ok = true;
    for (const { row, content } of messages) {
      if (!ok) {
        await this.outbound.abandon(scope, row);
        continue;
      }
      const final = await this.outbound.deliver(scope, { row, psid, encryptedToken, content });
      ok = final.status !== 'failed';
    }
    return ok;
  }

  /**
   * A retry that finds its work already committed: finish what the failed
   * attempt did not. Null when there is nothing to finish. No LLM call.
   */
  private async resume(
    scope: TenantScope,
    conversationId: string,
    read: {
      conversation: { state: string; handedOffAt: Date | null };
      recent: { id: string; sender: string; status: string; sentAt: Date }[];
    },
    triggerMessageId: string,
    gate: 'closed' | 'answered',
  ): Promise<TurnOutcome | null> {
    const trigger = read.recent.find((message) => message.id === triggerMessageId);
    if (!trigger) return null;
    const { conversation } = read;
    if (
      conversation.state === 'handed_off' &&
      conversation.handedOffAt &&
      conversation.handedOffAt >= trigger.sentAt
    ) {
      await this.notifications.handedOff(
        scope.merchantId,
        conversationId,
        conversation.handedOffAt,
      );
      return 'handed_off';
    }
    if (gate !== 'answered') return null;
    const reply = read.recent.find((message) => message.sender === 'assistant');
    if (!reply || reply.sentAt <= trigger.sentAt || reply.status !== 'failed') return null;
    const at = new Date(Math.max(Date.now(), trigger.sentAt.getTime() + 1));
    const wrote = await this.handOffAfterFailedSend(scope, conversationId, at);
    if (!wrote) return null;
    await this.notifications.handedOff(scope.merchantId, conversationId, wrote);
    return 'send_failed';
  }

  /** Under the conversation lock; null (and nothing written) for a chat already paused or handed off. */
  private async handOffAfterFailedSend(
    scope: TenantScope,
    conversationId: string,
    at: Date,
  ): Promise<Date | null> {
    return withMerchant(this.db, scope.merchantId, async (tx) => {
      const locked = await this.conversations.findById(tx, scope, conversationId, { lock: true });
      if (!locked || locked.conversation.botPaused || locked.conversation.state === 'handed_off') {
        return null;
      }
      await this.conversations.update(tx, scope, conversationId, {
        state: 'handed_off',
        handedOffAt: at,
      });
      return at;
    });
  }

  /**
   * The burst's photos matched to the catalog: copied to our bucket if the
   * copy job has not done it yet, then one vision call over a shortlist of
   * the shop's own products. No transaction is open across either.
   */
  private async readPhotos(
    scope: TenantScope,
    conversationId: string,
    burst: { messageIds: string[]; words: string },
    turn: Omit<TurnInput, 'trigger'>,
    calls: LlmCallRecord[],
  ): Promise<TurnDecision> {
    const urls: string[] = [];
    for (const messageId of burst.messageIds) {
      const copies = await this.photos.ensureStored(scope, messageId);
      for (const photo of copies?.photos ?? []) if (photo.ok) urls.push(photo.url);
    }
    const photos = urls.slice(0, MAX_PHOTOS_PER_TURN);
    if (photos.length === 0) return decidePhoto(turn, { kind: 'unreadable' });
    if (!this.llm) return handOff(turn.slots, 'llm_failed');
    const since = new Date(Date.now() - 24 * 3_600 * 1_000);
    const made = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.llmCalls.countSince(tx, scope, conversationId, 'vision_match', since),
    );
    if (made >= VISION_CALLS_PER_DAY) return handOff(turn.slots, 'unreadable');
    const shortlist = photoShortlist(turn.catalog, burst.words);
    if (shortlist.length === 0) return decidePhoto(turn, { kind: 'matched', productIds: [] });
    const matched = record(
      await this.llm.matchProductPhoto(photoMatchRequest(photos, shortlist, burst.words)),
      calls,
    );
    if (matched === 'failed') return handOff(turn.slots, 'llm_failed');
    return decidePhoto(turn, {
      kind: 'matched',
      productIds: matchedProductIds(matched, shortlist),
    });
  }

  private async decide(
    turn: Omit<TurnInput, 'trigger'>,
    history: ChatLine[],
    calls: LlmCallRecord[],
  ): Promise<TurnDecision> {
    const llm = this.llm;
    if (!llm) {
      return decideTurn({
        ...turn,
        trigger: { kind: 'message', classified: 'failed', extracted: 'skipped' },
      });
    }
    const classified = record(await llm.classifyIntent(history), calls);
    const extracted =
      classified !== 'failed' && shouldExtract(turn.state, classified.intent)
        ? record(
            await llm.extractOrder(history, extractionContext(turn.slots, turn.catalog)),
            calls,
          )
        : 'skipped';
    return decideTurn({ ...turn, trigger: { kind: 'message', classified, extracted } });
  }

  /**
   * The phrased reply if it passes checkReply; otherwise the fixed sentence.
   * A hand-off, the summary and the offered name are never phrased.
   */
  private async words(
    reply: ReplyIntent,
    history: ChatLine[],
    language: ReplyLanguage,
    voice: Pick<PhraseRequest, 'language' | 'tone'>,
    calls: LlmCallRecord[],
  ): Promise<string> {
    const fallback = fallbackText(reply, language);
    if (reply.kind !== 'ask_slot' || reply.offeredName !== undefined || !this.llm) return fallback;
    const phrased = record(
      await this.llm.phraseReply(phraseRequestFor(reply, voice), history.slice(-PHRASE_HISTORY)),
      calls,
    );
    return phrased !== 'failed' && checkReply(phrased, reply.facts).ok ? phrased.trim() : fallback;
  }
}

/**
 * The trigger's reply when it carries no words to read: decided by code, with
 * no LLM call. Null for words.
 */
function nonTextIn(
  recent: MessageRow[],
  triggerMessageId: string,
  turn: Pick<TurnInput, 'state' | 'slots'>,
): TurnDecision | 'silent' | null {
  const index = recent.findIndex((message) => message.id === triggerMessageId);
  const trigger = recent[index];
  if (!trigger) return null;
  const previous = recent
    .slice(index + 1)
    .find((message) => message.sender === 'customer' && message.kind !== 'reaction');
  return decideNonText({
    state: turn.state,
    slots: turn.slots,
    trigger: {
      kind: trigger.kind,
      text: trigger.editedText ?? trigger.text,
      details: readDetails(trigger.details),
    },
    previousKind: previous?.kind ?? null,
  });
}

const LINK_IN_TEXT = /\bhttps?:\/\/\S+/giu;

/**
 * The newest post or link shared in the burst the trigger ends (the
 * customer's messages since the last reply), and whether the burst holds
 * words of their own beside it ("how much is this?"). Null with no share.
 */
export function shareIn(
  recent: MessageRow[],
  triggerMessageId: string,
): { links: SharedLink[]; typed: boolean } | null {
  const index = recent.findIndex((message) => message.id === triggerMessageId);
  if (index < 0) return null;
  let links: SharedLink[] | null = null;
  let typed = false;
  for (const message of recent.slice(index)) {
    if (message.sender !== 'customer') break;
    if (message.kind === 'reaction') continue;
    const shared = readDetails(message.details).links ?? [];
    if (!links && shared.length > 0) links = shared;
    const words = (message.editedText ?? message.text).replace(LINK_IN_TEXT, '').trim();
    if (message.kind === 'text' && words && !isEmojiOnly(words)) typed = true;
  }
  return links ? { links, typed } : null;
}

/** The products a shared post's caption names: one clear match, or up to three close ones. */
function captionCandidates(caption: string, catalog: CatalogView): string[] {
  const match = matchProduct([caption], catalog);
  if (match.kind === 'one') return [match.productId];
  return match.kind === 'some' ? match.productIds : [];
}

/** The trigger's tap as a pick of an offered candidate, or null for anything else. */
function pickIn(
  recent: MessageRow[],
  triggerMessageId: string,
  slots: CollectedSlots,
): ItemPick | null {
  const tap = tapIn(recent, triggerMessageId);
  return tap?.kind === 'pick' ? validPick(slots, tap) : null;
}

type EntryTap =
  | { kind: 'browse'; categoryId: string | 'other' | null }
  | { kind: 'product'; productId: string; via: ProductVia }
  | { kind: 'last_order' }
  | { kind: 'human' };

/** The trigger's tap as an entry: Get Started, the menu, browsing, a carousel choice or a referral. */
function entryIn(tap: AssistantPayload | null): EntryTap | null {
  switch (tap?.kind) {
    case 'start':
      return { kind: 'browse', categoryId: null };
    case 'browse':
      return { kind: 'browse', categoryId: tap.categoryId };
    case 'product':
      return { kind: 'product', productId: tap.id, via: tap.via };
    case 'menu':
      return tap.item === 'human' ? { kind: 'human' } : { kind: 'last_order' };
    default:
      return null;
  }
}

function toEntry(
  tap: EntryTap,
  lastOrder: {
    reference: string;
    status: LastOrderFacts['status'];
    total: number;
    currency: string;
  } | null,
  language: ReplyLanguage,
): Entry {
  if (tap.kind === 'last_order') {
    return {
      kind: 'last_order',
      order: lastOrder && {
        reference: lastOrder.reference,
        status: lastOrder.status,
        total: formatMinorUnitsTrimmed(lastOrder.total, lastOrder.currency, LOCALES[language]),
      },
    };
  }
  if (tap.kind === 'product') return { kind: 'product', productId: tap.productId };
  return tap;
}

/** What the trigger's button or quick reply carried, when it was ours. */
function tapIn(recent: MessageRow[], triggerMessageId: string): AssistantPayload | null {
  const payload = recent.find((message) => message.id === triggerMessageId)?.payload;
  return payload ? parsePayload(payload) : null;
}

function record<T>(result: LlmResult<T>, calls: LlmCallRecord[]): T | 'failed' {
  calls.push({ ...result.usage, outcome: result.ok ? 'ok' : result.reason });
  return result.ok ? result.value : 'failed';
}

/**
 * The collected items as extraction sees them: the catalog's names once
 * matched, beside the customer's words. The offered profile name lets a typed
 * "yes" confirm it.
 */
export function extractionContext(slots: CollectedSlots, catalog: CatalogView): ExtractionContext {
  return {
    items: slots.items.map((item, ref) => {
      const product = catalog.products.find((entry) => entry.id === item.productId);
      const variant = product?.variants.find((entry) => entry.id === item.variantId);
      const variantName = variant?.name ?? item.variantQuery;
      return {
        ref,
        product: product?.name ?? item.productQuery ?? '',
        ...(item.productQuery ? { customerWords: item.productQuery } : {}),
        ...(variantName ? { variant: variantName } : {}),
        ...(item.variantQuery ? { customerVariantWords: item.variantQuery } : {}),
        ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
      };
    }),
    ...(slots.customerName === undefined ? {} : { customerName: slots.customerName }),
    ...(slots.phone === undefined ? {} : { phone: slots.phone }),
    ...(slots.deliveryAddress === undefined ? {} : { deliveryAddress: slots.deliveryAddress }),
    ...(slots.offeredName === undefined ? {} : { offeredName: slots.offeredName }),
  };
}

/** The shop's delivery rows and threshold, as the quote reads them. */
function deliveryView(
  rows: DeliveryChargeRow[],
  settings: { currency: string; freeDeliveryOver?: number | null },
): DeliveryView {
  const area = (row: DeliveryChargeRow) => ({
    id: row.id,
    areaName: row.areaName,
    charge: row.charge,
  });
  const fallback = rows.find((row) => row.isFallback);
  return {
    areas: rows.filter((row) => !row.isFallback).map(area),
    fallback: fallback ? area(fallback) : null,
    freeDeliveryOver: settings.freeDeliveryOver ?? null,
    currency: settings.currency,
  };
}
