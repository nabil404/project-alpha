import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import type { ConversationRow, MessageRow } from '../database/schema/index';
import { withMerchant } from '../database/with-merchant';
import { META_GRAPH } from '../messenger/page/facebook-page.service';
import type { MetaGraphClient } from '../messenger/page/meta-graph.client';
import { ConversationRepository } from './conversation.repository';
import { ConversationEventsPublisher } from './events/conversation-events.publisher';
import { MessageRepository } from './message.repository';

/**
 * A reply to a customer, from the seller or the assistant, in two halves so no
 * transaction is open across the Graph call (invariant #1): stage it inside
 * the caller's transaction, then deliver it after commit. A refused send stays
 * in the thread as `failed`. The echo Meta sends back carries our app id and
 * is skipped by the ingest.
 */
@Injectable()
export class OutboundMessageSender {
  private readonly logger = new Logger(OutboundMessageSender.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    private readonly events: ConversationEventsPublisher,
  ) {}

  /** Inside the caller's transaction, on a conversation it has locked. Only a seller's reply pauses the assistant. */
  async stage(
    tx: Executor,
    scope: TenantScope,
    conversation: ConversationRow,
    { sender, text, now }: { sender: 'seller' | 'assistant'; text: string; now: Date },
  ): Promise<MessageRow> {
    const row = await this.messages.insertSending(tx, scope, {
      conversationId: conversation.id,
      sender,
      text,
      sentAt: now,
    });
    await this.conversations.applyMessage(tx, scope, conversation, {
      sender,
      text,
      sentAt: now,
      pauseBot: sender === 'seller',
    });
    return row;
  }

  /** After commit: send, record the outcome, announce it. */
  async deliver(
    scope: TenantScope,
    { row, psid, encryptedToken }: { row: MessageRow; psid: string; encryptedToken: string },
  ): Promise<MessageRow> {
    let delivered: { messageId: string } | null = null;
    if (this.graph) {
      try {
        delivered = await this.graph.sendText(this.crypto.decrypt(encryptedToken), psid, row.text);
      } catch (error) {
        this.logger.warn(
          `${row.sender} reply not delivered: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    const final = await withMerchant(this.db, scope.merchantId, (tx) =>
      delivered
        ? this.messages.markSent(tx, scope, row.id, delivered.messageId)
        : this.messages.markFailed(tx, scope, row.id),
    );
    await this.events.publish({
      merchantId: scope.merchantId,
      conversationId: row.conversationId,
      kind: 'message',
    });
    return final;
  }
}
