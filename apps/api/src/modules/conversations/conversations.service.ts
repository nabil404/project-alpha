import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  collectedSlotsSchema,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationListResponse,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type Message,
  type MessagePage,
  type SendMessage,
  type UpdateConversation,
} from '@app/shared';
import { CryptoService } from '../../common/crypto.service';
import { CodedValidationException } from '../../common/errors/index';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { messengerNotConfigured } from '../messenger/page/facebook-page-errors';
import { FacebookPageRepository } from '../messenger/page/facebook-page.repository';
import { META_GRAPH } from '../messenger/page/facebook-page.service';
import type { MetaGraphClient } from '../messenger/page/meta-graph.client';
import {
  conversationNotFound,
  messengerPageNotConnected,
  messengerSendFailed,
  messengerWindowClosed,
} from './conversation-errors';
import { toConversationDetail, toConversationListItem, toMessage } from './conversation-mappers';
import { ConversationRepository } from './conversation.repository';
import { isReplyWindowOpen, replyWindowClosesAt, stateAfterHandBack } from './conversation-rules';
import { decodeCursor, encodeCursor, type CursorKey } from './cursor';
import { ConversationEventsPublisher } from './events/conversation-events.publisher';
import { MessageRepository } from './message.repository';

/**
 * The seller's side of Messenger conversations. Every read and write runs in
 * a short withMerchant transaction; Graph calls (send, Task 11) happen between
 * transactions, never inside one. Writes publish an event after commit.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    // Not `messages`: that would shadow the messages() method below.
    private readonly messageRows: MessageRepository,
    private readonly pages: FacebookPageRepository,
    private readonly crypto: CryptoService,
    @Inject(META_GRAPH) private readonly graph: MetaGraphClient | null,
    private readonly events: ConversationEventsPublisher,
  ) {}

  async list(scope: TenantScope, query: ListConversationsQuery): Promise<ConversationListResponse> {
    const after = query.cursor === undefined ? undefined : cursorOrReject('cursor', query.cursor);
    const rows = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.conversations.list(tx, scope, {
        filter: query.filter,
        q: query.q,
        after,
        limit: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.conversation;
    return {
      data: page.map((row) => toConversationListItem(row.conversation, row.customerName)),
      pagination: {
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ at: last.lastMessageAt, id: last.id })
            : null,
      },
    };
  }

  counts(scope: TenantScope): Promise<ConversationCounts> {
    return withMerchant(this.db, scope.merchantId, (tx) => this.conversations.counts(tx, scope));
  }

  async get(scope: TenantScope, id: string): Promise<ConversationDetail> {
    const found = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.conversations.findById(tx, scope, id),
    );
    if (!found) throw conversationNotFound();
    return toConversationDetail(found.conversation, found.customer);
  }

  async messages(scope: TenantScope, id: string, query: ListMessagesQuery): Promise<MessagePage> {
    const before = query.before === undefined ? undefined : cursorOrReject('before', query.before);
    const rows = await withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.conversations.findById(tx, scope, id))) throw conversationNotFound();
      return this.messageRows.listPage(tx, scope, id, { before, limit: query.limit + 1 });
    });
    const page = rows.slice(0, query.limit);
    const oldest = page.at(-1);
    return {
      data: [...page].reverse().map(toMessage),
      pagination: {
        prevCursor:
          rows.length > query.limit && oldest
            ? encodeCursor({ at: oldest.sentAt, id: oldest.id })
            : null,
      },
    };
  }

  /** Idempotent: announces a change only when something was unread. */
  async markRead(scope: TenantScope, id: string): Promise<void> {
    const changed = await withMerchant(this.db, scope.merchantId, async (tx) => {
      if (!(await this.conversations.findById(tx, scope, id))) throw conversationNotFound();
      return this.conversations.markRead(tx, scope, id);
    });
    if (!changed) return;
    await this.events.publish({
      merchantId: scope.merchantId,
      conversationId: id,
      kind: 'conversation',
    });
  }

  /**
   * Take over (pause) never changes state. Handing back a conversation the
   * assistant had handed off resumes it where its collected details put it.
   */
  async update(
    scope: TenantScope,
    id: string,
    { botPaused }: UpdateConversation,
  ): Promise<ConversationDetail> {
    const detail = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const found = await this.conversations.findById(tx, scope, id, { lock: true });
      if (!found) throw conversationNotFound();
      const handBack = !botPaused && found.conversation.state === 'handed_off';
      const row = await this.conversations.update(tx, scope, id, {
        botPaused,
        ...(handBack
          ? {
              state: stateAfterHandBack(
                collectedSlotsSchema.parse(found.conversation.collectedSlots),
              ),
            }
          : {}),
      });
      if (!row) throw conversationNotFound();
      return toConversationDetail(row, found.customer);
    });
    await this.events.publish({
      merchantId: scope.merchantId,
      conversationId: id,
      kind: 'conversation',
    });
    return detail;
  }

  /**
   * A seller reply, in three steps so no transaction is open across the Graph
   * call (invariant #1): check and store it as `sending` (pausing the
   * assistant), send, then record the outcome. A refused send stays in the
   * thread as `failed` and the seller retypes to retry. The echo Meta sends
   * back carries our app id and is skipped by the ingest.
   */
  async send(scope: TenantScope, id: string, { text }: SendMessage): Promise<Message> {
    const graph = this.graph;
    if (!graph) throw messengerNotConfigured();
    const now = new Date();

    const pending = await withMerchant(this.db, scope.merchantId, async (tx) => {
      const found = await this.conversations.findById(tx, scope, id, { lock: true });
      if (!found) throw conversationNotFound();
      const { conversation, customer } = found;
      if (!isReplyWindowOpen(conversation.lastInboundAt, now)) {
        throw messengerWindowClosed(replyWindowClosesAt(conversation.lastInboundAt));
      }
      const page = await this.pages.findForMerchant(tx, scope);
      if (!page || page.pageId !== conversation.facebookPageId) throw messengerPageNotConnected();

      const row = await this.messageRows.insertSending(tx, scope, {
        conversationId: id,
        text,
        sentAt: now,
      });
      await this.conversations.applyMessage(tx, scope, conversation, {
        sender: 'seller',
        text,
        sentAt: now,
        pauseBot: true,
      });
      return { row, psid: customer.psid, encryptedToken: page.accessToken };
    });

    let delivered: { messageId: string } | null = null;
    try {
      delivered = await graph.sendText(
        this.crypto.decrypt(pending.encryptedToken),
        pending.psid,
        text,
      );
    } catch (error) {
      this.logger.warn(
        `Seller reply not delivered: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const final = await withMerchant(this.db, scope.merchantId, (tx) =>
      delivered
        ? this.messageRows.markSent(tx, scope, pending.row.id, delivered.messageId)
        : this.messageRows.markFailed(tx, scope, pending.row.id),
    );
    await this.events.publish({
      merchantId: scope.merchantId,
      conversationId: id,
      kind: 'message',
    });
    if (!delivered) throw messengerSendFailed();
    return toMessage(final);
  }
}

function cursorOrReject(field: 'cursor' | 'before', value: string): CursorKey {
  const key = decodeCursor(value);
  if (!key) {
    throw new CodedValidationException({
      [field]: [{ code: 'INVALID_FORMAT', message: 'Not a cursor this API issued', params: {} }],
    });
  }
  return key;
}
