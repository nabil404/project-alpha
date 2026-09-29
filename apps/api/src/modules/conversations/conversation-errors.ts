import {
  CodedBadGatewayException,
  CodedConflictException,
  CodedNotFoundException,
} from '../../common/errors/index';

/** Also what another merchant's conversation looks like: never 403, which would confirm it exists. */
export const conversationNotFound = () =>
  new CodedNotFoundException('CONVERSATION_NOT_FOUND', 'Conversation not found');

export const messengerWindowClosed = (closedAt: Date | null) =>
  new CodedConflictException(
    'MESSENGER_WINDOW_CLOSED',
    'Messenger allows replies only within 24 hours of the customer’s last message',
    closedAt ? { closedAt: closedAt.toISOString() } : {},
  );

export const messengerSendFailed = () =>
  new CodedBadGatewayException('MESSENGER_SEND_FAILED', 'Messenger did not accept the message');

export const messengerPageNotConnected = () =>
  new CodedConflictException(
    'MESSENGER_PAGE_NOT_CONNECTED',
    'The Facebook Page this conversation belongs to is not connected',
  );
