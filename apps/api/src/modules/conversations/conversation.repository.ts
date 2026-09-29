import { Injectable } from '@nestjs/common';
import type {
  ConversationCounts,
  ConversationFilter,
  ConversationState,
  MessageSender,
} from '@app/shared';
import { and, desc, eq, exists, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import {
  conversation,
  customer,
  message,
  type ConversationRow,
  type CustomerRow,
} from '../../database/schema/index';
import { likePattern, messagePreview } from './conversation-rules';
import type { CursorKey } from './cursor';

export interface IncomingMessage {
  sender: MessageSender;
  text: string;
  sentAt: Date;
}

export interface ConversationListRow {
  conversation: ConversationRow;
  customerName: string | null;
}

export interface ConversationListQuery {
  filter: ConversationFilter;
  q?: string;
  /** Rows strictly after this key in newest-first order. */
  after?: CursorKey;
  limit: number;
}

/** The customer wrote after the seller last opened the thread. Mirrors isUnread(). */
const unread = sql`${conversation.lastInboundAt} > coalesce(${conversation.sellerLastReadAt}, '-infinity'::timestamptz)`;

function filterCondition(filter: ConversationFilter): SQL | undefined {
  switch (filter) {
    case 'all':
      return undefined;
    case 'needs_you':
      return eq(conversation.state, 'handed_off');
    case 'drafted':
      return eq(conversation.state, 'awaiting_confirmation');
    case 'unread':
      return unread;
  }
}

const withCustomer = and(
  eq(customer.merchantId, conversation.merchantId),
  eq(customer.id, conversation.customerId),
);

@Injectable()
export class ConversationRepository {
  /**
   * The customer's thread on this Page, created with their first message, then
   * locked FOR UPDATE: one customer's messages are written one at a time, in
   * order. A racing first message waits on the unique key, does nothing, and
   * locks the row the other created.
   */
  async lockOrCreate(
    executor: Executor,
    { merchantId }: TenantScope,
    {
      facebookPageId,
      customerId,
      first,
    }: { facebookPageId: string; customerId: string; first: IncomingMessage },
  ): Promise<ConversationRow> {
    await executor
      .insert(conversation)
      .values({
        merchantId,
        facebookPageId,
        customerId,
        lastMessageAt: first.sentAt,
        lastMessagePreview: messagePreview(first.text),
        lastMessageSender: first.sender,
      })
      .onConflictDoNothing({
        target: [conversation.merchantId, conversation.facebookPageId, conversation.customerId],
      });
    return one(
      await executor
        .select()
        .from(conversation)
        .where(
          and(
            eq(conversation.merchantId, merchantId),
            eq(conversation.facebookPageId, facebookPageId),
            eq(conversation.customerId, customerId),
          ),
        )
        .for('update'),
      'conversation lock',
    );
  }

  /**
   * Updates the list columns for a message just stored in `row` (locked by the
   * caller). A retried job can deliver an older message after a newer one, so
   * the columns only ever move forward.
   */
  async applyMessage(
    executor: Executor,
    { merchantId }: TenantScope,
    row: ConversationRow,
    { sender, text, sentAt, pauseBot = false }: IncomingMessage & { pauseBot?: boolean },
  ): Promise<ConversationRow> {
    const set: Partial<typeof conversation.$inferInsert> = {};
    if (sentAt >= row.lastMessageAt) {
      set.lastMessageAt = sentAt;
      set.lastMessagePreview = messagePreview(text);
      set.lastMessageSender = sender;
    }
    if (sender === 'customer' && (row.lastInboundAt === null || sentAt > row.lastInboundAt)) {
      set.lastInboundAt = sentAt;
    }
    if (pauseBot) set.botPaused = true;
    if (Object.keys(set).length === 0) return row;

    return one(
      await executor
        .update(conversation)
        .set(set)
        .where(and(eq(conversation.merchantId, merchantId), eq(conversation.id, row.id)))
        .returning(),
      'conversation update',
    );
  }

  /** Newest activity first, keyset-paginated on (last_message_at, id). */
  async list(
    executor: Executor,
    { merchantId }: TenantScope,
    { filter, q, after, limit }: ConversationListQuery,
  ): Promise<ConversationListRow[]> {
    const conditions: (SQL | undefined)[] = [
      eq(conversation.merchantId, merchantId),
      filterCondition(filter),
    ];
    if (q) {
      const pattern = likePattern(q);
      conditions.push(
        or(
          ilike(customer.name, pattern),
          exists(
            executor
              .select({ one: sql`1` })
              .from(message)
              .where(
                and(
                  eq(message.merchantId, merchantId),
                  eq(message.conversationId, conversation.id),
                  ilike(message.text, pattern),
                ),
              ),
          ),
        ),
      );
    }
    if (after) {
      conditions.push(
        sql`(${conversation.lastMessageAt}, ${conversation.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::text)`,
      );
    }

    return executor
      .select({ conversation, customerName: customer.name })
      .from(conversation)
      .innerJoin(customer, withCustomer)
      .where(and(...conditions))
      .orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
      .limit(limit);
  }

  /** One pass over the merchant's conversations; counts come back as strings and are converted here. */
  async counts(executor: Executor, { merchantId }: TenantScope): Promise<ConversationCounts> {
    const [row] = await executor
      .select({
        all: sql<string>`count(*)`,
        needsYou: sql<string>`count(*) filter (where ${conversation.state} = 'handed_off')`,
        drafted: sql<string>`count(*) filter (where ${conversation.state} = 'awaiting_confirmation')`,
        unread: sql<string>`count(*) filter (where ${unread})`,
      })
      .from(conversation)
      .where(eq(conversation.merchantId, merchantId));
    return {
      all: Number(row?.all ?? 0),
      needsYou: Number(row?.needsYou ?? 0),
      drafted: Number(row?.drafted ?? 0),
      unread: Number(row?.unread ?? 0),
    };
  }

  /** The conversation and its customer. `lock` takes the conversation row only. */
  async findById(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<{ conversation: ConversationRow; customer: CustomerRow } | null> {
    const query = executor
      .select({ conversation, customer })
      .from(conversation)
      .innerJoin(customer, withCustomer)
      .where(and(eq(conversation.merchantId, merchantId), eq(conversation.id, id)));
    const [row] = lock ? await query.for('update', { of: conversation }) : await query;
    return row ?? null;
  }

  /** Null when the merchant has no such conversation. */
  async update(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    values: { botPaused?: boolean; state?: ConversationState; sellerLastReadAt?: Date },
  ): Promise<ConversationRow | null> {
    const [row] = await executor
      .update(conversation)
      .set(values)
      .where(and(eq(conversation.merchantId, merchantId), eq(conversation.id, id)))
      .returning();
    return row ?? null;
  }
}
