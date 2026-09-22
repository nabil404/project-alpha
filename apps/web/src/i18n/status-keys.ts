import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  ConversationState,
  CustomerIntent,
  MessageDirection,
  OrderStatus,
  StockStatus,
} from '@app/shared';

/**
 * Every member of every shared enum must name a key in common.json.
 *
 * `satisfies Record<Enum, ParseKeys<'common'>>` fails the typecheck twice over:
 * once if an enum member in packages/shared has no entry here, and once if an
 * entry points at a key that doesn't exist in locales/en/common.json. A status
 * badge can't silently render blank.
 */
export const orderStatusKeys = {
  new: 'status.order.new',
  confirmed: 'status.order.confirmed',
  packed: 'status.order.packed',
  shipped: 'status.order.shipped',
  delivered: 'status.order.delivered',
  cancelled: 'status.order.cancelled',
} as const satisfies Record<OrderStatus, ParseKeys<'common'>>;

export const conversationStateKeys = {
  browsing: 'status.conversation.browsing',
  collecting_details: 'status.conversation.collecting_details',
  awaiting_confirmation: 'status.conversation.awaiting_confirmation',
  confirmed: 'status.conversation.confirmed',
  handed_off: 'status.conversation.handed_off',
  abandoned: 'status.conversation.abandoned',
} as const satisfies Record<ConversationState, ParseKeys<'common'>>;

export const stockStatusKeys = {
  in_stock: 'status.stock.in_stock',
  out_of_stock: 'status.stock.out_of_stock',
} as const satisfies Record<StockStatus, ParseKeys<'common'>>;

export const messageDirectionKeys = {
  inbound: 'status.messageDirection.inbound',
  outbound: 'status.messageDirection.outbound',
} as const satisfies Record<MessageDirection, ParseKeys<'common'>>;

export const customerIntentKeys = {
  browse: 'status.intent.browse',
  order: 'status.intent.order',
  ask_question: 'status.intent.ask_question',
  edit_order: 'status.intent.edit_order',
  complain: 'status.intent.complain',
  request_human: 'status.intent.request_human',
  other: 'status.intent.other',
} as const satisfies Record<CustomerIntent, ParseKeys<'common'>>;

/** Read labels through this, never by hand-writing a status key at a call site. */
export function useStatusLabels() {
  const { t } = useTranslation('common');

  return {
    orderStatus: (status: OrderStatus): string => t(orderStatusKeys[status]),
    conversationState: (state: ConversationState): string => t(conversationStateKeys[state]),
    stockStatus: (status: StockStatus): string => t(stockStatusKeys[status]),
    messageDirection: (direction: MessageDirection): string => t(messageDirectionKeys[direction]),
    customerIntent: (intent: CustomerIntent): string => t(customerIntentKeys[intent]),
  };
}
