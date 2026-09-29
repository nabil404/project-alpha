import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  INBOUND_MESSAGE_JOB,
  MESSENGER_QUEUE,
  type InboundMessageJob,
} from '../../queue/queue.constants';
import { InboundMessageIngest, type IngestOutcome } from './inbound-message.ingest';

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

  async process(job: Job<InboundMessageJob>): Promise<IngestOutcome> {
    if (job.name !== INBOUND_MESSAGE_JOB) {
      throw new Error(`Unknown job on ${MESSENGER_QUEUE}: ${job.name}`);
    }
    return this.ingest.handle(job.data);
  }
}
