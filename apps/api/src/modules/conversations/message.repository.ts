import { Injectable } from '@nestjs/common';
import type { MessageSender } from '@app/shared';
import type { Executor, TenantScope } from '../../database/base.repository';
import { message, type MessageRow } from '../../database/schema/index';

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
}
