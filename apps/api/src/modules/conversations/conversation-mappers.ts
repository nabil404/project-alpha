import type { ConversationDetail, ConversationListItem, Message } from '@app/shared';
import type { ConversationRow, CustomerRow, MessageRow } from '../database/schema/index';
import { isUnread, replyWindowClosesAt } from './conversation-rules';

export function toConversationListItem(
  row: ConversationRow,
  customer: Pick<CustomerRow, 'name' | 'pictureUrl'>,
): ConversationListItem {
  return {
    id: row.id,
    customer: { id: row.customerId, name: customer.name, pictureUrl: customer.pictureUrl },
    state: row.state,
    botPaused: row.botPaused,
    unread: isUnread(row.lastInboundAt, row.sellerLastReadAt),
    lastMessage: {
      preview: row.lastMessagePreview,
      sender: row.lastMessageSender,
      at: row.lastMessageAt.toISOString(),
    },
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
  };
}

export function toConversationDetail(
  row: ConversationRow,
  customer: CustomerRow,
): ConversationDetail {
  return {
    id: row.id,
    customer: { id: customer.id, name: customer.name, pictureUrl: customer.pictureUrl },
    state: row.state,
    botPaused: row.botPaused,
    unread: isUnread(row.lastInboundAt, row.sellerLastReadAt),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    replyWindowClosesAt: replyWindowClosesAt(row.lastInboundAt)?.toISOString() ?? null,
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sender: row.sender,
    text: row.text,
    status: row.status,
    sentAt: row.sentAt.toISOString(),
  };
}
