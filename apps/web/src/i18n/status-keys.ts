import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  ConversationState,
  CustomerIntent,
  MessageSender,
  MessageStatus,
  OrderStatus,
  ProductStatus,
  StockLevel,
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

/** The Products page's finer reading; in and out share the variant status's labels. */
export const stockLevelKeys = {
  in_stock: 'status.stock.in_stock',
  low_stock: 'status.stock.low_stock',
  out_of_stock: 'status.stock.out_of_stock',
} as const satisfies Record<StockLevel, ParseKeys<'common'>>;

export const productStatusKeys = {
  draft: 'status.product.draft',
  active: 'status.product.active',
  archived: 'status.product.archived',
} as const satisfies Record<ProductStatus, ParseKeys<'common'>>;

export const messageSenderKeys = {
  customer: 'status.messageSender.customer',
  assistant: 'status.messageSender.assistant',
  seller: 'status.messageSender.seller',
} as const satisfies Record<MessageSender, ParseKeys<'common'>>;

export const messageStatusKeys = {
  sending: 'status.messageStatus.sending',
  sent: 'status.messageStatus.sent',
  failed: 'status.messageStatus.failed',
} as const satisfies Record<MessageStatus, ParseKeys<'common'>>;

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
    stockLevel: (level: StockLevel): string => t(stockLevelKeys[level]),
    productStatus: (status: ProductStatus): string => t(productStatusKeys[status]),
    messageSender: (sender: MessageSender): string => t(messageSenderKeys[sender]),
    messageStatus: (status: MessageStatus): string => t(messageStatusKeys[status]),
    customerIntent: (intent: CustomerIntent): string => t(customerIntentKeys[intent]),
  };
}
