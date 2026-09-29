import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MessageSender } from '@app/shared';
import { CryptoService } from '../../../common/crypto.service';
import { AppConfig } from '../../../config/app.config';
import type { TenantScope } from '../../../database/base.repository';
import { DATABASE, type Database } from '../../../database/database.module';
import { withMerchant } from '../../../database/with-merchant';
import { FacebookPageRepository } from '../../messenger/page/facebook-page.repository';
import { META_GRAPH } from '../../messenger/page/facebook-page.service';
import type { MetaGraphClient } from '../../messenger/page/meta-graph.client';
import type { InboundMessageJob } from '../../queue/queue.constants';
import { ConversationRepository } from '../conversation.repository';
import { needsProfile } from '../conversation-rules';
import { CustomerRepository, type CustomerProfile } from '../customer.repository';
import { ConversationEventsPublisher } from '../events/conversation-events.publisher';
import { MessageRepository } from '../message.repository';
import { resolvePageMerchant } from './page-merchant';

export type IngestOutcome = 'stored' | 'duplicate' | 'own-echo' | 'unknown-page';

/**
 * Stores one message Meta delivered: a customer's, or an echo of the seller's
 * reply from Facebook's inbox, which pauses the assistant.
 *
 * Order is load-bearing (backend invariant #1): read, call Graph for the
 * customer's name outside any transaction, then one short transaction that
 * locks the conversation and writes, then publish after commit.
 *
 * This is where the AI spec will queue the assistant's turn, after a stored
 * customer message, when the conversation is not paused and the Page's bot is
 * enabled. Until then nothing replies automatically.
 */
@Injectable()
export class InboundMessageIngest {
  private readonly logger = new Logger(InboundMessageIngest.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    private readonly pages: FacebookPageRepository,
    private readonly customers: CustomerRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly events: ConversationEventsPublisher,
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
        ? await this.fetchProfile(page.accessToken, psid)
        : undefined;

    const conversationId = await withMerchant(this.db, merchantId, async (tx) => {
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
      return thread.id;
    });

    if (!conversationId) return 'duplicate';
    await this.events.publish({ merchantId, conversationId, kind: 'message' });
    return 'stored';
  }

  /** Never fails the job: a customer without a name is still a customer. */
  private async fetchProfile(encryptedToken: string, psid: string): Promise<CustomerProfile> {
    const fetchedAt = new Date();
    if (!this.graph) return { name: null, fetchedAt };
    try {
      return {
        name: await this.graph.getUserName(this.crypto.decrypt(encryptedToken), psid),
        fetchedAt,
      };
    } catch (error) {
      this.logger.warn(
        `Customer profile not read: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { name: null, fetchedAt };
    }
  }
}
