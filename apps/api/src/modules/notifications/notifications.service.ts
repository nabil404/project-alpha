import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CUSTOMER_WAITING_DELAY_MS,
  CUSTOMER_WAITING_JOB,
  EVENT_JOB_RETENTION,
  IMPORT_FINISHED_JOB,
  NOTIFICATIONS_QUEUE,
  ORDER_DRAFTED_JOB,
  type CustomerWaitingJob,
  type ImportFinishedJob,
  type OrderDraftedJob,
} from '../queue/queue.constants';

/**
 * Enqueues the events seller emails are about; the worker decides at run time
 * whether anyone still wants the email. Call these only after the event's
 * transaction commits, or the job finds nothing. Job ids come from the event,
 * so a repeat call is a no-op while EVENT_JOB_RETENTION keeps the first job.
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

  /**
   * An import run ended at `endedAt`: finished, stopped or failed. A resumed
   * run that ends again is a new event, so the id carries the end time.
   */
  async importFinished(merchantId: string, importId: string, endedAt: Date): Promise<void> {
    const data: ImportFinishedJob = { merchantId, importId, endedAt: endedAt.getTime() };
    await this.queue.add(IMPORT_FINISHED_JOB, data, {
      ...EVENT_JOB_RETENTION,
      jobId: `import-finished-${importId}-${endedAt.getTime()}`,
    });
  }
}
