import type { ConversationDetail, ConversationListItem, Message } from '@app/shared';
import type { ConversationRow, CustomerRow, MessageRow } from '../database/schema/index';
import { isUnread, replyWindowClosesAt } from './conversation-rules';
import { readDetails } from './message-content';

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
      kind: row.lastMessageKind,
      at: row.lastMessageAt.toISOString(),
    },
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
  };
}

export function toConversationDetail(
  row: ConversationRow,
  customer: CustomerRow,
  latestOrderId: string | null,
): ConversationDetail {
  return {
    id: row.id,
    customer: { id: customer.id, name: customer.name, pictureUrl: customer.pictureUrl },
    state: row.state,
    botPaused: row.botPaused,
    unread: isUnread(row.lastInboundAt, row.sellerLastReadAt),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    replyWindowClosesAt: replyWindowClosesAt(row.lastInboundAt)?.toISOString() ?? null,
    latestOrderId,
  };
}

export function toMessage(row: MessageRow): Message {
  const details = readDetails(row.details);
  return {
    id: row.id,
    sender: row.sender,
    kind: row.kind,
    text: row.text,
    attachments: (details.attachments ?? []).map(({ url }) => ({ url: safeUrl(url) })),
    location: details.location ?? null,
    links: (details.links ?? []).map(({ url, title }) => ({ url: safeUrl(url), title })),
    reaction: details.reaction
      ? { emoji: details.reaction.emoji, messageId: details.reaction.targetMessageId }
      : null,
    editedText: row.editedText,
    deleted: row.deletedAt !== null,
    status: row.status,
    sentAt: row.sentAt.toISOString(),
  };
}

/** Only an https link reaches the browser: it is Meta's, but it came in a webhook. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
