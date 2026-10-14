import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  encodePayload,
  parsePayload,
  type AssistantPayload,
  type ConversationState,
  type EntrySource,
  type MessageSender,
} from '@app/shared';
import { AppConfig } from '../../config/app.config';
import type { TenantScope } from '../../database/base.repository';
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
import { MessageRepository } from '../message.repository';
import { CustomerProfileReader } from '../profiles/customer-profile.reader';
import { resolvePageMerchant } from './page-merchant';

export type IngestOutcome = 'stored' | 'duplicate' | 'own-echo' | 'unknown-page';

/** Thrown inside the write transaction so a redelivery rolls back its ad count. */
class DuplicateDelivery extends Error {}

/** What an entry stores: the payload the turn reads, the source, and the row's text. */
export function entryOf(
  job: InboundMessageJob,
  mappedProductId: string | null,
  language: ReplyLanguage,
): { payload: string | null; source: EntrySource | null; text: string } {
  if (job.kind === 'page-echo') return { payload: null, source: null, text: job.text };
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

    const adReferral = job.kind === 'page-echo' ? undefined : job.referral;
    let written: {
      conversationId: string;
      messageId: string;
      botPaused: boolean;
      state: ConversationState;
      tapped: AssistantPayload | null;
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
        const tapped = entry.payload === null ? null : parsePayload(entry.payload);
        const cardTap = tapped?.kind === 'confirm' || tapped?.kind === 'change';
        const stored = await this.messages.insertDelivered(tx, scope, {
          conversationId: thread.id,
          sender,
          text: entry.text,
          metaMessageId: job.messageId,
          sentAt,
          payload: entry.payload,
        });
        if (!stored) throw new DuplicateDelivery();
        const reopened =
          sender === 'customer' && thread.state === 'confirmed' && !cardTap
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
          text: entry.text,
          sentAt,
          pauseBot: sender === 'seller',
        });
        return {
          conversationId: thread.id,
          messageId: stored.id,
          botPaused: thread.botPaused,
          state: (reopened ?? thread).state,
          tapped,
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
    if (
      sender === 'customer' &&
      page?.botEnabled === true &&
      this.assistantWanted(written, written.tapped)
    ) {
      const data: AssistantTurnJob = {
        merchantId,
        conversationId: written.conversationId,
        triggerMessageId: written.messageId,
      };
      await this.assistantTurns.add(ASSISTANT_TURN_JOB, data, {
        jobId: customJobId('turn-', job.messageId),
        // A tapped button is a decision, not part of a burst still being typed.
        delay:
          job.kind === 'customer-message' && written.tapped?.kind !== 'product'
            ? ASSISTANT_TURN_DELAY_MS
            : 0,
        ...ASSISTANT_TURN_RETRY,
      });
    }
    return 'stored';
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
