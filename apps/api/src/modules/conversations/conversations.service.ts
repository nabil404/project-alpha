import { Inject, Injectable } from '@nestjs/common';
import {
  collectedSlotsSchema,
  type ConversationCounts,
  type ConversationDetail,
  type ConversationListResponse,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessagePage,
  type UpdateConversation,
} from '@app/shared';
import { CodedValidationException } from '../../common/errors/index';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { conversationNotFound } from './conversation-errors';
import { toConversationDetail, toConversationListItem, toMessage } from './conversation-mappers';
import { ConversationRepository } from './conversation.repository';
import { stateAfterHandBack } from './conversation-rules';
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
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly conversations: ConversationRepository,
    // Not `messages`: that would shadow the messages() method below.
    private readonly messageRows: MessageRepository,
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

  async markRead(scope: TenantScope, id: string): Promise<void> {
    const row = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.conversations.update(tx, scope, id, { sellerLastReadAt: new Date() }),
    );
    if (!row) throw conversationNotFound();
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
