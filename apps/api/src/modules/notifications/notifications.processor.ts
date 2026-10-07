import { type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { MailService } from '../mail/mail.service';
import type { MailMessage } from '../mail/templates';
import {
  CUSTOMER_WAITING_JOB,
  DAILY_SUMMARY_JOB,
  DAILY_SUMMARY_SCAN_JOB,
  EVENT_JOB_RETENTION,
  NOTIFICATIONS_QUEUE,
  ORDER_DRAFTED_JOB,
  SEND_EMAIL_JOB,
  type CustomerWaitingJob,
  type DailySummaryJob,
  type OrderDraftedJob,
} from '../queue/queue.constants';
import { NotificationComposer, type NotificationEmail } from './notification-composer';
import { DAILY_SUMMARY_SCAN_MINUTES } from './shop-clock';

const DAILY_SUMMARY_SCHEDULE = `*/${DAILY_SUMMARY_SCAN_MINUTES} * * * *`;
const DAILY_SUMMARY_SCHEDULER_ID = 'daily-summary-scan';

/**
 * The moment the scheduler meant a scan for, not when a worker got to it: a
 * scan that waits behind sends or retries still summarises the shops whose
 * 9:00 it was for, rather than finding none at 9:15.
 */
function scheduledFor(job: Job): Date {
  return new Date(job.opts.prevMillis ?? job.timestamp);
}

/** What a job reports, for Bull Board and the specs. */
export interface NotificationJobResult {
  queued: number;
}

/**
 * Registered only in WorkerModule: the API boots AppModule too, and a processor
 * there would consume jobs in the HTTP process.
 *
 * An event job writes its emails and queues one SEND_EMAIL_JOB each, named
 * after the event and the person, so a retried event never mails anyone twice
 * and a failed send retries alone.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly composer: NotificationComposer,
    private readonly mail: MailService,
  ) {
    super();
  }

  /** Idempotent: every worker boot updates the one scheduler instead of adding another. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      DAILY_SUMMARY_SCHEDULER_ID,
      { pattern: DAILY_SUMMARY_SCHEDULE, tz: 'UTC' },
      { name: DAILY_SUMMARY_SCAN_JOB },
    );
  }

  async process(job: Job): Promise<NotificationJobResult | void> {
    switch (job.name) {
      case ORDER_DRAFTED_JOB: {
        const { merchantId, orderId } = job.data as OrderDraftedJob;
        return this.queueEmails(job, await this.composer.orderDrafted(merchantId, orderId));
      }
      case CUSTOMER_WAITING_JOB: {
        const { merchantId, conversationId, handedOffAt } = job.data as CustomerWaitingJob;
        const emails = await this.composer.customerWaiting(
          merchantId,
          conversationId,
          new Date(handedOffAt),
        );
        return this.queueEmails(job, emails);
      }
      case DAILY_SUMMARY_SCAN_JOB: {
        const due = await this.composer.dailySummariesDue(scheduledFor(job));
        await this.queue.addBulk(
          due.map(({ merchantId, day }) => ({
            name: DAILY_SUMMARY_JOB,
            data: { merchantId, day } satisfies DailySummaryJob,
            opts: { ...EVENT_JOB_RETENTION, jobId: `daily-summary-${merchantId}-${day}` },
          })),
        );
        return { queued: due.length };
      }
      case DAILY_SUMMARY_JOB: {
        const { merchantId, day } = job.data as DailySummaryJob;
        return this.queueEmails(job, await this.composer.dailySummary(merchantId, day));
      }
      case SEND_EMAIL_JOB:
        // Throws on failure, so BullMQ retries this one message.
        return this.mail.send(job.data as MailMessage);
      default:
        throw new UnrecoverableError(`Unknown job on ${NOTIFICATIONS_QUEUE}: ${job.name}`);
    }
  }

  private async queueEmails(job: Job, emails: NotificationEmail[]): Promise<NotificationJobResult> {
    if (!job.id) throw new Error(`A ${job.name} job has no id`);
    await this.queue.addBulk(
      emails.map(({ userId, message }) => ({
        name: SEND_EMAIL_JOB,
        data: message,
        opts: { jobId: `${job.id}-${userId}` },
      })),
    );
    return { queued: emails.length };
  }
}
