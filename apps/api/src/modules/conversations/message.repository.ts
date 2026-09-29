import { Injectable } from '@nestjs/common';
import type { MessageSender } from '@app/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../../database/base.repository';
import { message, type MessageRow } from '../../database/schema/index';
import type { CursorKey } from './cursor';

@Injectable()
export class MessageRepository {
  /**
   * A message Meta delivered (the customer's, or an echo of the seller's).
   * Null when this mid is already stored: a redelivery that got past the
   * BullMQ jobId, which the unique key turns into a no-op.
   */
  async insertDelivered(
    executor: Executor,
    { merchantId }: TenantScope,
    values: {
      conversationId: string;
      sender: MessageSender;
      text: string;
      metaMessageId: string;
      sentAt: Date;
    },
  ): Promise<MessageRow | null> {
    const [row] = await executor
      .insert(message)
      .values({ ...values, merchantId, status: 'sent' })
      .onConflictDoNothing({ target: [message.merchantId, message.metaMessageId] })
      .returning();
    return row ?? null;
  }

  /** Newest first, keyset-paginated on (sent_at, id). The caller reverses for display. */
  async listPage(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    { before, limit }: { before?: CursorKey; limit: number },
  ): Promise<MessageRow[]> {
    return executor
      .select()
      .from(message)
      .where(
        and(
          eq(message.merchantId, merchantId),
          eq(message.conversationId, conversationId),
          before
            ? sql`(${message.sentAt}, ${message.id}) < (${before.at.toISOString()}::timestamptz, ${before.id}::text)`
            : undefined,
        ),
      )
      .orderBy(desc(message.sentAt), desc(message.id))
      .limit(limit);
  }
}
