import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import type { Executor, TenantScope } from '../database/base.repository';
import { DATABASE, type Database } from '../database/database.module';
import type { ConversationRow, MessageRow } from '../database/schema/index';
import { withMerchant } from '../database/with-merchant';
import { META_GRAPH } from '../messenger/page/facebook-page.service';
import type { GraphOption, MetaGraphClient } from '../messenger/page/meta-graph.client';
import { ConversationRepository } from './conversation.repository';
import { ConversationEventsPublisher } from './events/conversation-events.publisher';
import { MessageRepository } from './message.repository';

/**
 * How a staged row goes out. The row's text is the body in every case, and
 * what the dashboard thread shows.
 */
export type OutboundContent =
  | { kind: 'text' }
  | { kind: 'quick_replies'; options: GraphOption[] }
  | { kind: 'card'; buttons: GraphOption[] };

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
    {
      row,
      psid,
      encryptedToken,
      content,
    }: { row: MessageRow; psid: string; encryptedToken: string; content: OutboundContent },
  ): Promise<MessageRow> {
    let delivered: { messageId: string } | null = null;
    if (this.graph) {
      try {
        delivered = await this.send(
          this.graph,
          this.crypto.decrypt(encryptedToken),
          psid,
          row.text,
          content,
        );
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

  /** After commit: a staged row that will not be sent, because one before it failed. */
  async abandon(scope: TenantScope, row: MessageRow): Promise<MessageRow> {
    const final = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.messages.markFailed(tx, scope, row.id),
    );
    await this.events.publish({
      merchantId: scope.merchantId,
      conversationId: row.conversationId,
      kind: 'message',
    });
    return final;
  }

  /**
   * A product photo before the turn's text. Best effort and unstored: the
   * text that follows carries the turn, and the echo is skipped as our own.
   */
  async deliverImage(psid: string, encryptedToken: string, url: string): Promise<boolean> {
    if (!this.graph) return false;
    try {
      await this.graph.sendImage(this.crypto.decrypt(encryptedToken), psid, url);
      return true;
    } catch (error) {
      this.logger.warn(
        `assistant image not delivered: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  private send(
    graph: MetaGraphClient,
    token: string,
    psid: string,
    text: string,
    content: OutboundContent,
  ): Promise<{ messageId: string }> {
    switch (content.kind) {
      case 'text':
        return graph.sendText(token, psid, text);
      case 'quick_replies':
        return graph.sendQuickReplies(token, psid, text, content.options);
      case 'card':
        return graph.sendButtonTemplate(token, psid, text, content.buttons);
    }
  }
}
