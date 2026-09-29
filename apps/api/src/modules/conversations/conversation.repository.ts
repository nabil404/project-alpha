import { Injectable } from '@nestjs/common';
import type { MessageSender } from '@app/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { one } from '../../database/rows';
import { conversation, type ConversationRow } from '../../database/schema/index';
import { messagePreview } from './conversation-rules';

export interface IncomingMessage {
  sender: MessageSender;
  text: string;
  sentAt: Date;
}

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
}
