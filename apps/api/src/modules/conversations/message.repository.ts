import { Injectable } from '@nestjs/common';
import type { MessageSender } from '@app/shared';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { Executor, TenantScope } from '../database/base.repository';
import { one } from '../database/rows';
import { message, type MessageRow } from '../database/schema/index';
import type { CursorKey } from './cursor';

/**
 * How long a staged send may be in flight before a retry may send it again:
 * past the Graph call's 10 s timeout, and short of the 30 s after which
 * BullMQ reruns a job whose worker died.
 */
export const SEND_LEASE_SECONDS = 20;

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
      payload?: string | null;
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

  /** A reply, stored before it is sent so the thread shows it while Messenger answers. */
  async insertSending(
    executor: Executor,
    { merchantId }: TenantScope,
    values: { conversationId: string; sender: 'seller' | 'assistant'; text: string; sentAt: Date },
  ): Promise<MessageRow> {
    return one(
      await executor
        .insert(message)
        .values({ ...values, merchantId, status: 'sending' })
        .returning(),
      'message insert',
    );
  }

  async markSent(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
    metaMessageId: string,
  ): Promise<MessageRow> {
    return one(
      await executor
        .update(message)
        .set({ status: 'sent', metaMessageId })
        .where(and(eq(message.merchantId, merchantId), eq(message.id, id)))
        .returning(),
      'message sent',
    );
  }

  /** One message of one conversation; null when either is not this merchant's. */
  async findInConversation(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    id: string,
  ): Promise<MessageRow | null> {
    const [row] = await executor
      .select()
      .from(message)
      .where(
        and(
          eq(message.merchantId, merchantId),
          eq(message.conversationId, conversationId),
          eq(message.id, id),
        ),
      );
    return row ?? null;
  }

  /** The conversation's newest message, for the list columns after a delete. */
  async latest(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
  ): Promise<MessageRow | null> {
    const [row] = await executor
      .select()
      .from(message)
      .where(and(eq(message.merchantId, merchantId), eq(message.conversationId, conversationId)))
      .orderBy(desc(message.sentAt), desc(message.id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Deletes a seller reply Messenger refused. The sender and status are part of
   * the predicate, so nothing that reached the customer can ever be deleted
   * here. False when no such failed reply exists.
   */
  async deleteFailed(
    executor: Executor,
    { merchantId }: TenantScope,
    conversationId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await executor
      .delete(message)
      .where(
        and(
          eq(message.merchantId, merchantId),
          eq(message.conversationId, conversationId),
          eq(message.id, id),
          eq(message.sender, 'seller'),
          eq(message.status, 'failed'),
        ),
      )
      .returning({ id: message.id });
    return rows.length > 0;
  }

  /**
   * Takes a stored reply for one more send: a failed one, or one still
   * `sending` after `SEND_LEASE_SECONDS`, whose sender died before recording
   * the outcome. The update is the compare-and-set: of two runs that read
   * the same row, only one gets it back. Null when it went out, or another
   * run's send of it is still in flight.
   */
  async claimForResend(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<MessageRow | null> {
    const [row] = await executor
      .update(message)
      .set({ status: 'sending', updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(message.merchantId, merchantId),
          eq(message.id, id),
          or(
            eq(message.status, 'failed'),
            and(
              eq(message.status, 'sending'),
              sql`${message.updatedAt} < clock_timestamp() - make_interval(secs => ${SEND_LEASE_SECONDS})`,
            ),
          ),
        ),
      )
      .returning();
    return row ?? null;
  }

  async markFailed(
    executor: Executor,
    { merchantId }: TenantScope,
    id: string,
  ): Promise<MessageRow> {
    return one(
      await executor
        .update(message)
        .set({ status: 'failed' })
        .where(and(eq(message.merchantId, merchantId), eq(message.id, id)))
        .returning(),
      'message failed',
    );
  }
}
