import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, id, instant, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';
import { customer } from './customers';

/** Literal copies of the @app/shared enums (drizzle-kit loads this file on its own); the schema spec keeps them equal. */
const CONVERSATION_STATES = [
  'browsing',
  'collecting_details',
  'awaiting_confirmation',
  'confirmed',
  'handed_off',
  'abandoned',
] as const;
const MESSAGE_SENDERS = ['customer', 'assistant', 'seller'] as const;
const MESSAGE_STATUSES = ['sending', 'sent', 'failed'] as const;

export const CONVERSATION_THREAD_UQ = 'conversation_merchant_page_customer_uq';
export const MESSAGE_META_ID_UQ = 'message_merchant_meta_message_id_uq';

/**
 * One long-lived Messenger thread per customer per Page.
 *
 * `facebook_page_id` is Facebook's Page id, deliberately not a foreign key to
 * facebook_page: disconnecting deletes that row and reconnecting creates a new
 * one, so history keyed on it would cascade away or split in two.
 *
 * `bot_paused` is the seller's takeover; `state = handed_off` is the assistant
 * giving up. The `last_*` columns are denormalized for the list and its cursor.
 */
export const conversation = pgTable(
  'conversation',
  {
    id: id(),
    merchantId: merchantId(),
    facebookPageId: text('facebook_page_id').notNull(),
    customerId: text('customer_id').notNull(),
    state: text('state', { enum: CONVERSATION_STATES }).notNull().default('browsing'),
    /** Parsed with collectedSlotsSchema on read. */
    collectedSlots: jsonb('collected_slots')
      .$type<unknown>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    botPaused: boolean('bot_paused').notNull().default(false),
    lastMessageAt: instant('last_message_at').notNull(),
    lastMessagePreview: text('last_message_preview').notNull(),
    lastMessageSender: text('last_message_sender', { enum: MESSAGE_SENDERS }).notNull(),
    /** The customer's last message: the 24h reply window, "Active N min ago", and unread. */
    lastInboundAt: instant('last_inbound_at'),
    sellerLastReadAt: timestamp('seller_last_read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('conversation_merchant_id_uq').on(t.merchantId, t.id),
    unique(CONVERSATION_THREAD_UQ).on(t.merchantId, t.facebookPageId, t.customerId),
    foreignKey({
      name: 'conversation_customer_fk',
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customer.merchantId, customer.id],
    }),
    check('conversation_state_ck', oneOf(t.state, CONVERSATION_STATES)),
    check('conversation_last_sender_ck', oneOf(t.lastMessageSender, MESSAGE_SENDERS)),
    index('conversation_merchant_last_message_idx').on(
      t.merchantId,
      t.lastMessageAt.desc(),
      t.id.desc(),
    ),
    index('conversation_needs_you_idx')
      .on(t.merchantId)
      .where(sql`${t.state} = 'handed_off'`),
    index('conversation_drafted_idx')
      .on(t.merchantId)
      .where(sql`${t.state} = 'awaiting_confirmation'`),
    merchantIsolation('conversation_merchant_isolation', t.merchantId),
  ],
);

export type ConversationRow = typeof conversation.$inferSelect;

/**
 * `meta_message_id` is null only while a seller reply is in flight; Postgres
 * treats nulls as distinct, so those never collide in the unique key.
 */
export const message = pgTable(
  'message',
  {
    id: id(),
    merchantId: merchantId(),
    conversationId: text('conversation_id').notNull(),
    sender: text('sender', { enum: MESSAGE_SENDERS }).notNull(),
    text: text('text').notNull(),
    metaMessageId: text('meta_message_id'),
    status: text('status', { enum: MESSAGE_STATUSES }).notNull(),
    sentAt: instant('sent_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'message_conversation_fk',
      columns: [t.merchantId, t.conversationId],
      foreignColumns: [conversation.merchantId, conversation.id],
    }).onDelete('cascade'),
    unique(MESSAGE_META_ID_UQ).on(t.merchantId, t.metaMessageId),
    check('message_sender_ck', oneOf(t.sender, MESSAGE_SENDERS)),
    check('message_status_ck', oneOf(t.status, MESSAGE_STATUSES)),
    index('message_thread_idx').on(t.merchantId, t.conversationId, t.sentAt, t.id),
    index('message_text_trgm_idx').using('gin', t.text.op('gin_trgm_ops')),
    merchantIsolation('message_merchant_isolation', t.merchantId),
  ],
);

export type MessageRow = typeof message.$inferSelect;
