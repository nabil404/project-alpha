import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import {
  INBOUND_MESSAGE_JOB,
  MESSENGER_QUEUE,
  type InboundMessageJob,
} from '../../queue/queue.constants';
import { InboundMessageIngest, type IngestOutcome } from './inbound-message.ingest';

const inboundMessageBase = {
  messageId: z.string().min(1),
  pageId: z.string().min(1),
  text: z.string(),
  sentAt: z.number(),
};

/**
 * What the worker accepts from MESSENGER_QUEUE. A job queued before messages
 * carried a `kind` could only be a customer's message, so it reads as one.
 */
const inboundMessageJobSchema = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && !('kind' in value)
      ? { ...value, kind: 'customer-message' }
      : value,
  z.discriminatedUnion('kind', [
    z.object({
      ...inboundMessageBase,
      kind: z.literal('customer-message'),
      senderPsid: z.string().min(1),
    }),
    z.object({
      ...inboundMessageBase,
      kind: z.literal('page-echo'),
      recipientPsid: z.string().min(1),
      appId: z.string().optional(),
    }),
  ]),
);

/**
 * Registered only in WorkerModule: the API boots AppModule too, and a
 * processor there would consume jobs in the HTTP process. BullMQ's default
 * concurrency of 1 stays well under DATABASE_POOL_MAX.
 */
@Processor(MESSENGER_QUEUE)
export class InboundMessageProcessor extends WorkerHost {
  constructor(private readonly ingest: InboundMessageIngest) {
    super();
  }

  /** A job that cannot be read fails once: a retry would read it the same way. */
  async process(job: Job<InboundMessageJob>): Promise<IngestOutcome> {
    if (job.name !== INBOUND_MESSAGE_JOB) {
      throw new UnrecoverableError(`Unknown job on ${MESSENGER_QUEUE}: ${job.name}`);
    }
    const parsed = inboundMessageJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Field paths only: an issue's message can quote the value, and the value can be message text.
      const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
      throw new UnrecoverableError(
        `Malformed ${INBOUND_MESSAGE_JOB} job ${job.id ?? ''} on ${MESSENGER_QUEUE}: ${fields.join(', ')}`,
      );
    }
    const data: InboundMessageJob = parsed.data;
    return this.ingest.handle(data);
  }
}
