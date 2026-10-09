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

/** The most items one assistant order holds; extraction and the slots are capped at it. */
export const MAX_ORDER_ITEMS = 10;

/**
 * What the assistant collects, in the order it asks: for each item in turn its
 * product, its variant (only when the product has more than one) and its
 * quantity; then the order's name, phone and address.
 */
export const slotNames = [
  'product',
  'variant',
  'quantity',
  'customerName',
  'phone',
  'deliveryAddress',
] as const;
export const slotNameSchema = z.enum(slotNames);
export type SlotName = z.infer<typeof slotNameSchema>;

/** Slots that belong to one item of the order rather than to the order. */
export type ItemSlotName = Extract<SlotName, 'product' | 'variant' | 'quantity'>;

const words = z.string().min(1);
const uuid = z.string().uuid();
const minor = z.number().int().nonnegative();

/**
 * One item of the order. The `*Query` fields are the customer's own words,
 * kept so a later turn can match them again; `*Alt` is the same words in the
 * other script (Bangla ⇄ Latin). The ids are what code matched them to.
 */
export const orderItemSlotSchema = z.object({
  productQuery: words.optional(),
  productQueryAlt: words.optional(),
  variantQuery: words.optional(),
  variantQueryAlt: words.optional(),
  productId: uuid.optional(),
  variantId: uuid.optional(),
  quantity: z.number().int().positive().optional(),
});
export type OrderItemSlot = z.infer<typeof orderItemSlotSchema>;

/** One priced line of a quote, in minor units. */
export const quoteLineSchema = z.object({
  productId: uuid,
  variantId: uuid,
  quantity: z.number().int().positive(),
  unitPrice: minor,
  lineTotal: minor,
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

/** The numbers the summary card with `revision` showed. Confirm creates an order only if they still hold. */
export const quoteSchema = z.object({
  revision: z.number().int().positive(),
  lines: z.array(quoteLineSchema).min(1).max(MAX_ORDER_ITEMS),
  subtotal: minor,
  deliveryChargeId: uuid,
  deliveryFee: minor,
  total: minor,
  currency: z.string().length(3),
});
export type Quote = z.infer<typeof quoteSchema>;

/** Quick replies Messenger shows at most. */
export const MAX_QUICK_REPLIES = 13;

export const collectedSlotsSchema = z.object({
  items: z.array(orderItemSlotSchema).max(MAX_ORDER_ITEMS).default([]),
  customerName: words.optional(),
  /** E.164. */
  phone: words.optional(),
  deliveryAddress: words.optional(),
  /** The area or district the customer named, in their words. */
  deliveryArea: words.optional(),
  /** The shop's delivery charge the address matched, or its everywhere-else row. */
  deliveryChargeId: uuid.optional(),
  /** Candidates offered as quick replies for one item; a tap must name one of them. */
  offered: z
    .object({
      slot: z.enum(['product', 'variant']),
      item: z.number().int().nonnegative(),
      ids: z.array(uuid).min(1).max(MAX_QUICK_REPLIES),
    })
    .optional(),
  /** Bumped by every summary card sent; a Confirm carrying an older one is refused. */
  revision: z.number().int().nonnegative().default(0),
  /** What the card with `revision` showed. */
  quote: quoteSchema.optional(),
  /** The slot (and item) asked for last and how many times in a row; the third ask hands off instead. */
  lastAsked: z
    .object({
      slot: slotNameSchema,
      item: z.number().int().nonnegative().optional(),
      times: z.number().int().positive(),
    })
    .optional(),
});
export type CollectedSlots = z.infer<typeof collectedSlotsSchema>;

/** Nothing collected yet. */
export function emptySlots(): CollectedSlots {
  return { items: [], revision: 0 };
}

export type MissingSlot =
  { slot: ItemSlotName; item: number } | { slot: Exclude<SlotName, ItemSlotName> };

/**
 * The next thing to ask for, or null when the order is complete. An empty
 * item list asks for a product. `needsVariant` says whether a matched product
 * has more than one variant to choose from.
 */
export function nextMissingSlot(
  slots: CollectedSlots,
  needsVariant: (productId: string) => boolean,
): MissingSlot | null {
  if (slots.items.length === 0) return { slot: 'product', item: 0 };
  for (const [item, entry] of slots.items.entries()) {
    if (entry.productId === undefined) return { slot: 'product', item };
    if (entry.variantId === undefined && needsVariant(entry.productId)) {
      return { slot: 'variant', item };
    }
    if (entry.quantity === undefined) return { slot: 'quantity', item };
  }
  if (slots.customerName === undefined) return { slot: 'customerName' };
  if (slots.phone === undefined) return { slot: 'phone' };
  if (slots.deliveryAddress === undefined) return { slot: 'deliveryAddress' };
  return null;
}

/** Whether the customer has given anything towards an order yet. */
export function hasCollectedAnything(slots: CollectedSlots): boolean {
  return (
    slots.items.length > 0 ||
    slots.customerName !== undefined ||
    slots.phone !== undefined ||
    slots.deliveryAddress !== undefined
  );
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
