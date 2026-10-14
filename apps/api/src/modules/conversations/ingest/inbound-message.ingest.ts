import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  encodePayload,
  parsePayload,
  type AssistantPayload,
  type ConversationState,
  type EntrySource,
  type MessageKind,
  type MessageSender,
} from '@app/shared';
import { AppConfig } from '../../config/app.config';
import type { Executor, TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { AdProductRepository } from '../../messenger/ads/ad-product.repository';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import {
  ASSISTANT_QUEUE,
  ASSISTANT_TURN_DELAY_MS,
  ASSISTANT_TURN_JOB,
  ASSISTANT_TURN_RETRY,
  type AssistantTurnJob,
  type CustomerEditJob,
  type CustomerReactionJob,
  type CustomerUnsendJob,
  type InboundMessageJob,
} from '../../queue/queue.constants';
import { customJobId } from '../../queue/job-id';
import { defaultMerchantSettings } from '../../settings/general-settings.service';
import { MerchantSettingsRepository } from '../../settings/merchant-settings.repository';
import { REFERRAL_TEXT, languageFor, type ReplyLanguage } from '../assistant/assistant-fallbacks';
import { ConversationRepository } from '../conversation.repository';
import { needsProfile, slotsForNextOrder } from '../conversation-rules';
import { readSlots } from '../assistant/conversation-machine';
import { CustomerRepository } from '../customer.repository';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { attachmentContent, isEmojiOnly, type MessageDetails } from '../message-content';
import { MessageRepository } from '../message.repository';
import { CustomerProfileReader } from '../profiles/customer-profile.reader';
import { resolvePageMerchant } from './page-merchant';

export type IngestOutcome =
  | 'stored'
  | 'duplicate'
  | 'own-echo'
  | 'unknown-page'
  /** An edit, unsend or reaction removal for a message we never stored. */
  | 'unknown-target';

/** A job that stores a new message row; edits, unsends and reaction removals change one. */
type NewMessageJob = Exclude<InboundMessageJob, CustomerEditJob | CustomerUnsendJob>;

/** Sent instead of words: none of these starts the next order on a confirmed chat. */
const NOT_AN_ORDER: ReadonlySet<MessageKind> = new Set(['reaction', 'sticker']);

/** Thrown inside the write transaction so a redelivery rolls back its ad count. */
class DuplicateDelivery extends Error {}

/** What an entry stores: the payload the turn reads, the source, and the row's text. */
export function entryOf(
  job: NewMessageJob,
  mappedProductId: string | null,
  language: ReplyLanguage,
): { payload: string | null; source: EntrySource | null; text: string } {
  if (job.kind === 'page-echo' || job.kind === 'customer-reaction') {
    return { payload: null, source: null, text: job.text };
  }
  const referral = job.referral;
  const product =
    referral?.kind === 'link'
      ? referral.productId
      : referral?.kind === 'ad'
        ? mappedProductId
        : null;
  // Typed is decided here: only a message carries words of the customer's own.
  const payload = product
    ? encodePayload({
        kind: 'product',
        via: job.kind === 'customer-message' ? 'ref-typed' : 'ref',
        id: product,
      })
    : job.kind === 'customer-referral'
      ? encodePayload({ kind: 'browse', categoryId: null })
      : (job.payload ?? null);
  const source: EntrySource | null = referral
    ? referral.kind === 'ad'
      ? 'ad'
      : 'link'
    : payload === 'start'
      ? 'get_started'
      : null;
  const text =
    job.kind === 'customer-referral' && referral
      ? REFERRAL_TEXT[language][referral.kind === 'ad' ? 'ad' : 'link']
      : job.text;
  return { payload, source, text };
}

/**
 * Stores one message from Meta: a customer's, including button and quick-reply
 * taps with their payload, or an echo of the seller's reply from Facebook's
 * inbox, which pauses the assistant.
 *
 * Follows invariant #1: the Graph profile fetch runs outside any transaction,
 * then one short locked write, then publish after commit. A customer message
 * on a confirmed chat starts the next order unless it taps the summary card.
 * It queues the assistant's turn unless the seller took over, the assistant is
 * off, the chat is handed off, or no LLM or Graph is configured.
 */
@Injectable()
export class InboundMessageIngest {
  private readonly logger = new Logger(InboundMessageIngest.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: AppConfig,
    private readonly profiles: CustomerProfileReader,
    private readonly pages: FacebookPageRepository,
    private readonly customers: CustomerRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly ads: AdProductRepository,
    private readonly settings: MerchantSettingsRepository,
    private readonly events: ConversationEventsPublisher,
    @InjectQueue(ASSISTANT_QUEUE) private readonly assistantTurns: Queue,
  ) {}

  async handle(job: InboundMessageJob): Promise<IngestOutcome> {
    // Our own sends are written by whoever sent them (the dashboard, later the assistant).
    if (
      job.kind === 'page-echo' &&
      job.appId !== undefined &&
      job.appId === this.config.get('META_APP_ID')
    ) {
      return 'own-echo';
    }

    const merchantId = await resolvePageMerchant(this.db, job.pageId);
    if (!merchantId) {
      this.logger.warn(`Dropped a message for Page ${job.pageId}, which no shop has connected`);
      return 'unknown-page';
    }
    switch (job.kind) {
      case 'customer-edit':
        return this.edit(job, merchantId);
      case 'customer-unsend':
        return this.unsend(job, merchantId);
      case 'customer-reaction':
        return job.action === 'unreact'
          ? this.unreact(job, merchantId)
          : this.store(job, merchantId);
      default:
        return this.store(job, merchantId);
    }
  }

  private async store(job: NewMessageJob, merchantId: string): Promise<IngestOutcome> {
    const scope: TenantScope = { merchantId };
    const psid = job.kind === 'page-echo' ? job.recipientPsid : job.senderPsid;
    const sender: MessageSender = job.kind === 'page-echo' ? 'seller' : 'customer';
    const sentAt = new Date(job.sentAt);

    const { existing, page, country } = await withMerchant(this.db, merchantId, async (tx) => ({
      existing: await this.customers.findByPsid(tx, scope, psid),
      page: await this.pages.findForMerchant(tx, scope),
      country: (await this.settings.find(tx, scope))?.country ?? defaultMerchantSettings().country,
    }));
    const language = languageFor(country);
    const profile =
      page && needsProfile(existing, new Date())
        ? (await this.profiles.read(page.accessToken, psid)).profile
        : undefined;

    const adReferral = 'referral' in job ? job.referral : undefined;
    let written: {
      conversationId: string;
      messageId: string;
      botPaused: boolean;
      state: ConversationState;
      tapped: AssistantPayload | null;
      kind: MessageKind;
    } | null;
    try {
      written = await withMerchant(this.db, merchantId, async (tx) => {
        const customerRow = await this.customers.upsert(tx, scope, { psid, profile });
        const thread = await this.conversations.lockOrCreate(tx, scope, {
          facebookPageId: job.pageId,
          customerId: customerRow.id,
          first: { sender, text: entryOf(job, null, language).text, sentAt },
        });
        // Before insertDelivered, so a redelivery can roll the count back.
        const mapped =
          adReferral?.kind === 'ad'
            ? await this.ads.recordSeen(tx, scope, {
                pageId: job.pageId,
                adId: adReferral.adId,
                at: sentAt,
              })
            : null;
        const entry = entryOf(job, mapped, language);
        const content = await this.contentOf(tx, scope, job, entry.text);
        const tapped = entry.payload === null ? null : parsePayload(entry.payload);
        const cardTap = tapped?.kind === 'confirm' || tapped?.kind === 'change';
        const stored = await this.messages.insertDelivered(tx, scope, {
          conversationId: thread.id,
          sender,
          text: content.text,
          metaMessageId: job.messageId,
          sentAt,
          payload: entry.payload,
          kind: content.kind,
          details: content.details,
        });
        if (!stored) throw new DuplicateDelivery();
        const nextOrder =
          !cardTap &&
          !NOT_AN_ORDER.has(content.kind) &&
          !(content.kind === 'text' && isEmojiOnly(content.text));
        const reopened =
          sender === 'customer' && thread.state === 'confirmed' && nextOrder
            ? await this.conversations.update(tx, scope, thread.id, {
                state: 'browsing',
                collectedSlots: slotsForNextOrder(readSlots(thread.collectedSlots)),
                entrySource: 'organic',
              })
            : null;
        if (entry.source) {
          await this.conversations.update(tx, scope, thread.id, { entrySource: entry.source });
        }
        await this.conversations.applyMessage(tx, scope, thread, {
          sender,
          text: content.text,
          kind: content.kind,
          sentAt,
          pauseBot: sender === 'seller',
          opensWindow: sender === 'customer' && content.kind !== 'reaction',
        });
        return {
          conversationId: thread.id,
          messageId: stored.id,
          botPaused: thread.botPaused,
          state: (reopened ?? thread).state,
          tapped,
          kind: content.kind,
        };
      });
    } catch (error) {
      if (error instanceof DuplicateDelivery) return 'duplicate';
      throw error;
    }

    if (!written) return 'duplicate';
    await this.events.publish({
      merchantId,
      conversationId: written.conversationId,
      kind: 'message',
    });
    // A reaction asks nothing, except on the summary card, where it is pointed to Confirm.
    const reactionWanted = written.kind !== 'reaction' || written.state === 'awaiting_confirmation';
    if (
      sender === 'customer' &&
      page?.botEnabled === true &&
      reactionWanted &&
      this.assistantWanted(written, written.tapped)
    ) {
      // A tapped button is a decision, not part of a burst still being typed.
      const burst = job.kind === 'customer-message' && written.tapped?.kind !== 'product';
      await this.queueTurn(merchantId, written, job.messageId, burst);
    }
    return 'stored';
  }

  /** The row's kind, text and details: words as sent; anything else holds none. */
  private async contentOf(
    tx: Executor,
    scope: TenantScope,
    job: NewMessageJob,
    text: string,
  ): Promise<{ kind: MessageKind; text: string; details: MessageDetails | null }> {
    if (job.kind === 'customer-reaction') {
      const target = await this.messages.findByMetaId(tx, scope, job.targetMid);
      return {
        kind: 'reaction',
        text: job.emoji,
        details: {
          reaction: {
            emoji: job.emoji,
            label: job.reaction,
            targetMid: job.targetMid,
            targetMessageId: target?.id ?? null,
          },
        },
      };
    }
    if (job.kind === 'customer-message' && job.attachments && !job.text) {
      return attachmentContent(job.attachments);
    }
    return { kind: 'text', text, details: null };
  }

  /**
   * Keeps the edit beside the original. Before the summary card, an edit asks
   * the turn again (the gate drops it unless the message is still the
   * customer's latest); from the card on, it is shown and never read.
   */
  private async edit(job: CustomerEditJob, merchantId: string): Promise<IngestOutcome> {
    const scope: TenantScope = { merchantId };
    const outcome = await withMerchant(this.db, merchantId, async (tx) => {
      const target = await this.messages.findByMetaId(tx, scope, job.targetMid);
      if (!target || target.sender !== 'customer') return 'unknown-target' as const;
      const locked = await this.conversations.findById(tx, scope, target.conversationId, {
        lock: true,
      });
      if (!locked || locked.customer.psid !== job.senderPsid) return 'unknown-target' as const;
      const edited = await this.messages.applyEdit(tx, scope, target.id, {
        text: job.text,
        at: new Date(job.sentAt),
      });
      if (!edited) return 'duplicate' as const;
      const page = await this.pages.findForMerchant(tx, scope);
      return {
        conversationId: locked.conversation.id,
        messageId: target.id,
        botPaused: locked.conversation.botPaused,
        state: locked.conversation.state,
        botEnabled: page?.botEnabled === true,
      };
    });
    if (typeof outcome === 'string') return outcome;

    await this.events.publish({
      merchantId,
      conversationId: outcome.conversationId,
      kind: 'message',
    });
    const beforeCard = outcome.state === 'browsing' || outcome.state === 'collecting_details';
    if (outcome.botEnabled && beforeCard && this.assistantWanted(outcome, null)) {
      await this.queueTurn(merchantId, outcome, job.messageId, true);
    }
    return 'stored';
  }

  /** Marks the message unsent. What it filled in stays: the seller sees both. */
  private async unsend(job: CustomerUnsendJob, merchantId: string): Promise<IngestOutcome> {
    const scope: TenantScope = { merchantId };
    const outcome = await withMerchant(this.db, merchantId, async (tx) => {
      const target = await this.messages.findByMetaId(tx, scope, job.targetMid);
      if (!target || target.sender !== 'customer') return 'unknown-target' as const;
      const deleted = await this.messages.markDeleted(tx, scope, target.id, new Date(job.sentAt));
      return deleted ? deleted.conversationId : ('duplicate' as const);
    });
    if (outcome === 'unknown-target' || outcome === 'duplicate') return outcome;
    await this.events.publish({ merchantId, conversationId: outcome, kind: 'message' });
    return 'stored';
  }

  private async unreact(job: CustomerReactionJob, merchantId: string): Promise<IngestOutcome> {
    const scope: TenantScope = { merchantId };
    const retracted = await withMerchant(this.db, merchantId, (tx) =>
      this.messages.retractReaction(tx, scope, job.targetMid, new Date(job.sentAt)),
    );
    if (!retracted) return 'duplicate';
    await this.events.publish({
      merchantId,
      conversationId: retracted.conversationId,
      kind: 'message',
    });
    return 'stored';
  }

  /** The turn's job id comes from the event, so each edit asks once and a redelivery not at all. */
  private async queueTurn(
    merchantId: string,
    written: { conversationId: string; messageId: string },
    eventId: string,
    burst: boolean,
  ): Promise<void> {
    const data: AssistantTurnJob = {
      merchantId,
      conversationId: written.conversationId,
      triggerMessageId: written.messageId,
    };
    await this.assistantTurns.add(ASSISTANT_TURN_JOB, data, {
      jobId: customJobId('turn-', eventId),
      delay: burst ? ASSISTANT_TURN_DELAY_MS : 0,
      ...ASSISTANT_TURN_RETRY,
    });
  }

  /**
   * Graph to send with and an LLM to think with; a chat the seller holds or
   * the assistant left stays theirs. A chat still confirmed here was tapped on
   * its summary card: Confirm gets the order's reference again, Change nothing.
   */
  private assistantWanted(
    { botPaused, state }: { botPaused: boolean; state: ConversationState },
    tapped: AssistantPayload | null,
  ): boolean {
    return (
      Boolean(this.config.get('LLM_API_KEY')) &&
      Boolean(this.config.get('META_APP_ID')) &&
      !botPaused &&
      state !== 'handed_off' &&
      (state !== 'confirmed' || tapped?.kind === 'confirm')
    );
  }
}
