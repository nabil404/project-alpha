import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { ConversationState, MessageSender } from '@app/shared';
import { AppConfig } from '../../config/app.config';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import {
  ASSISTANT_QUEUE,
  ASSISTANT_TURN_DELAY_MS,
  ASSISTANT_TURN_JOB,
  type AssistantTurnJob,
  type InboundMessageJob,
} from '../../queue/queue.constants';
import { ConversationRepository } from '../conversation.repository';
import { needsProfile } from '../conversation-rules';
import { CustomerRepository } from '../customer.repository';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { MessageRepository } from '../message.repository';
import { CustomerProfileReader } from '../profiles/customer-profile.reader';
import { resolvePageMerchant } from './page-merchant';

export type IngestOutcome = 'stored' | 'duplicate' | 'own-echo' | 'unknown-page';

/**
 * Stores one message Meta delivered: a customer's, or an echo of the seller's
 * reply from Facebook's inbox, which pauses the assistant.
 *
 * Order is load-bearing (backend invariant #1): read, call Graph for the
 * customer's profile outside any transaction, then one short transaction that
 * locks the conversation and writes, then publish after commit.
 *
 * After a stored customer message it queues the assistant's turn, unless the
 * seller has taken over, the Page's assistant is off, the chat is handed off or
 * confirmed, or no LLM or Graph is configured.
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
    const psid = job.kind === 'customer-message' ? job.senderPsid : job.recipientPsid;
    const sender: MessageSender = job.kind === 'customer-message' ? 'customer' : 'seller';
    const sentAt = new Date(job.sentAt);

    const { existing, page } = await withMerchant(this.db, merchantId, async (tx) => ({
      existing: await this.customers.findByPsid(tx, scope, psid),
      page: await this.pages.findForMerchant(tx, scope),
    }));
    const profile =
      page && needsProfile(existing, new Date())
        ? (await this.profiles.read(page.accessToken, psid)).profile
        : undefined;

    const written = await withMerchant(this.db, merchantId, async (tx) => {
      const customerRow = await this.customers.upsert(tx, scope, { psid, profile });
      const thread = await this.conversations.lockOrCreate(tx, scope, {
        facebookPageId: job.pageId,
        customerId: customerRow.id,
        first: { sender, text: job.text, sentAt },
      });
      const stored = await this.messages.insertDelivered(tx, scope, {
        conversationId: thread.id,
        sender,
        text: job.text,
        metaMessageId: job.messageId,
        sentAt,
      });
      if (!stored) return null;
      await this.conversations.applyMessage(tx, scope, thread, {
        sender,
        text: job.text,
        sentAt,
        pauseBot: sender === 'seller',
      });
      return {
        conversationId: thread.id,
        messageId: stored.id,
        botPaused: thread.botPaused,
        state: thread.state,
      };
    });

    if (!written) return 'duplicate';
    await this.events.publish({
      merchantId,
      conversationId: written.conversationId,
      kind: 'message',
    });
    if (sender === 'customer' && page?.botEnabled === true && this.assistantWanted(written)) {
      const data: AssistantTurnJob = {
        merchantId,
        conversationId: written.conversationId,
        triggerMessageId: written.messageId,
      };
      await this.assistantTurns.add(ASSISTANT_TURN_JOB, data, {
        jobId: `turn-${job.messageId}`,
        delay: ASSISTANT_TURN_DELAY_MS,
      });
    }
    return 'stored';
  }

  /** Graph to send with and an LLM to think with; a chat the seller holds or the assistant left stays theirs. */
  private assistantWanted({
    botPaused,
    state,
  }: {
    botPaused: boolean;
    state: ConversationState;
  }): boolean {
    return (
      Boolean(this.config.get('LLM_API_KEY')) &&
      Boolean(this.config.get('META_APP_ID')) &&
      !botPaused &&
      state !== 'handed_off' &&
      state !== 'confirmed'
    );
  }
}
