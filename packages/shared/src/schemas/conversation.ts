import { z } from 'zod';

/** browsing -> collecting_details -> awaiting_confirmation -> confirmed, plus handed_off and abandoned. */
export const conversationStates = [
  'browsing',
  'collecting_details',
  'awaiting_confirmation',
  'confirmed',
  'handed_off',
  'abandoned',
] as const;

export const conversationStateSchema = z.enum(conversationStates);
export type ConversationState = z.infer<typeof conversationStateSchema>;

/** Every field the state machine must collect before a summary can be shown. */
export const requiredOrderFields = [
  'product',
  'variant',
  'quantity',
  'customerName',
  'phone',
  'deliveryAddress',
] as const;

export const collectedSlotsSchema = z.object({
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive().optional(),
  customerName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  deliveryAddress: z.string().min(1).optional(),
});
export type CollectedSlots = z.infer<typeof collectedSlotsSchema>;

export function missingSlots(slots: CollectedSlots): string[] {
  const required: (keyof CollectedSlots)[] = [
    'productId',
    'variantId',
    'quantity',
    'customerName',
    'phone',
    'deliveryAddress',
  ];
  return required.filter((field) => slots[field] === undefined);
}

/** Who wrote a message: the customer, our assistant, or the seller (dashboard or Facebook's own inbox). */
export const messageSenders = ['customer', 'assistant', 'seller'] as const;
export const messageSenderSchema = z.enum(messageSenders);
export type MessageSender = z.infer<typeof messageSenderSchema>;

/** Inbound messages are always `sent`; a seller reply is `sending` until Messenger accepts it. */
export const messageStatuses = ['sending', 'sent', 'failed'] as const;
export const messageStatusSchema = z.enum(messageStatuses);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/** Messenger's limit on one text message. */
export const MESSAGE_TEXT_MAX_LENGTH = 2000;

/** Messenger's standard messaging window: replies are allowed this long after the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The Conversations page's filter chips: All, Needs you (handed off), Drafted (awaiting confirmation), Unread. */
export const conversationFilters = ['all', 'needs_you', 'drafted', 'unread'] as const;
export const conversationFilterSchema = z.enum(conversationFilters);
export type ConversationFilter = z.infer<typeof conversationFilterSchema>;

/** An empty `q=` in the URL means no search, not a failed one. */
const searchTerm = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(100).optional(),
);

/** GET /conversations. `cursor` is opaque: pass back the `nextCursor` a previous page returned. */
export const listConversationsQuerySchema = z.object({
  filter: conversationFilterSchema.default('all'),
  q: searchTerm,
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const conversationCustomerSchema = z.object({
  id: z.string().uuid(),
  /** Null until Facebook shares the customer's profile. */
  name: z.string().nullable(),
  /** Facebook's signed CDN link. It expires, so the image may fail to load. */
  pictureUrl: z.string().url().nullable(),
});

export const conversationListItemSchema = z.object({
  id: z.string().uuid(),
  customer: conversationCustomerSchema,
  state: conversationStateSchema,
  botPaused: z.boolean(),
  unread: z.boolean(),
  lastMessage: z.object({
    preview: z.string(),
    sender: messageSenderSchema,
    at: z.string().datetime(),
  }),
  lastInboundAt: z.string().datetime().nullable(),
});
export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

export const conversationListResponseSchema = z.object({
  data: z.array(conversationListItemSchema),
  pagination: z.object({ nextCursor: z.string().nullable() }),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/** GET /conversations/counts: the filter chips and the sidebar badge. Ignores search. */
export const conversationCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  needsYou: z.number().int().nonnegative(),
  drafted: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});
export type ConversationCounts = z.infer<typeof conversationCountsSchema>;

export const conversationDetailSchema = z.object({
  id: z.string().uuid(),
  customer: conversationCustomerSchema,
  state: conversationStateSchema,
  botPaused: z.boolean(),
  unread: z.boolean(),
  lastInboundAt: z.string().datetime().nullable(),
  /** When the seller can no longer reply; null if the customer has never written. */
  replyWindowClosesAt: z.string().datetime().nullable(),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  sender: messageSenderSchema,
  text: z.string(),
  status: messageStatusSchema,
  sentAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

/** GET /conversations/:id/messages. `before` is the `prevCursor` of a newer page. */
export const listMessagesQuerySchema = z.object({
  before: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** Chronological (oldest first). `prevCursor` loads the page before it, or is null at the start. */
export const messagePageSchema = z.object({
  data: z.array(messageSchema),
  pagination: z.object({ prevCursor: z.string().nullable() }),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

/** PATCH /conversations/:id: take over (true) or hand back (false). State is never client-set. */
export const updateConversationSchema = z.object({ botPaused: z.boolean() }).strict();
export type UpdateConversation = z.infer<typeof updateConversationSchema>;

/** POST /conversations/:id/messages: a seller reply. */
export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX_LENGTH),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

/** The one SSE event on GET /conversations/events. Carries an id only: refetch over REST. */
export const CONVERSATION_UPDATED_EVENT = 'conversation.updated';
export const conversationUpdatedEventSchema = z.object({ conversationId: z.string().uuid() });
export type ConversationUpdatedEvent = z.infer<typeof conversationUpdatedEventSchema>;

/**
 * The last event of a stream the server closed because the shop has too many
 * open: close the EventSource rather than reconnect, or tabs evict each other.
 */
export const CONVERSATION_STREAM_EVICTED_EVENT = 'evicted';
