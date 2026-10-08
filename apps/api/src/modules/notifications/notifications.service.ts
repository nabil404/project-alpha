import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CUSTOMER_WAITING_DELAY_MS,
  CUSTOMER_WAITING_JOB,
  EVENT_JOB_RETENTION,
  NOTIFICATIONS_QUEUE,
  ORDER_DRAFTED_JOB,
  type CustomerWaitingJob,
  type OrderDraftedJob,
} from '../queue/queue.constants';

/**
 * Where the rest of the app reports the events seller emails are about. Each
 * call only enqueues; the worker decides, when the job runs, whether anyone
 * still wants the email. Call these after the transaction that made the event
 * has committed - a job that runs first would find nothing to tell.
 *
 * Job ids come from the event, so calling twice for the same one is a no-op
 * for as long as EVENT_JOB_RETENTION keeps the first job.
 */
@Injectable()
export class NotificationsService {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  /** The assistant wrote an order from a customer's confirmation. */
  async orderDrafted(merchantId: string, orderId: string): Promise<void> {
    const data: OrderDraftedJob = { merchantId, orderId };
    await this.queue.add(ORDER_DRAFTED_JOB, data, {
      ...EVENT_JOB_RETENTION,
      jobId: `order-drafted-${orderId}`,
    });
  }

  /**
   * The assistant handed a conversation to the seller at `at`, the
   * `handed_off_at` that write stored. The email waits CUSTOMER_WAITING_DELAY_MS
   * and goes only if the chat is still on that handoff and nobody has replied;
   * a later handoff of the same chat is a new event with its own job.
   */
  async handedOff(merchantId: string, conversationId: string, at: Date): Promise<void> {
    const data: CustomerWaitingJob = { merchantId, conversationId, handedOffAt: at.getTime() };
    await this.queue.add(CUSTOMER_WAITING_JOB, data, {
      ...EVENT_JOB_RETENTION,
      jobId: `customer-waiting-${conversationId}-${at.getTime()}`,
      delay: CUSTOMER_WAITING_DELAY_MS,
    });
  }
}
