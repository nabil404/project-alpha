import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import {
  IMPORT_POST_JOB,
  IMPORT_RUN_JOB,
  IMPORTS_CONCURRENCY,
  IMPORTS_QUEUE,
} from '../queue/queue.constants';
import { ImportRunner } from './import-runner';

const runJobSchema = z.object({ merchantId: z.string().min(1), importId: z.string().uuid() });
const postJobSchema = runJobSchema.extend({ postId: z.string().uuid() });

/** Registered only in WorkerModule, through ImportsWorkerModule. */
@Processor(IMPORTS_QUEUE, { concurrency: IMPORTS_CONCURRENCY })
export class ImportsProcessor extends WorkerHost {
  constructor(private readonly runner: ImportRunner) {
    super();
  }

  /**
   * Throws while Graph or storage is down, for BullMQ to retry from the run's
   * cursor; on the last attempt the run fails, or Import anyway marks its post
   * `failed`, instead.
   */
  async process(job: Job): Promise<void> {
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    switch (job.name) {
      case IMPORT_RUN_JOB: {
        const parsed = runJobSchema.safeParse(job.data);
        if (!parsed.success)
          throw new UnrecoverableError(`Malformed ${job.name} job ${job.id ?? ''}`);
        return this.runner.run(parsed.data.merchantId, parsed.data.importId, { lastAttempt });
      }
      case IMPORT_POST_JOB: {
        const parsed = postJobSchema.safeParse(job.data);
        if (!parsed.success)
          throw new UnrecoverableError(`Malformed ${job.name} job ${job.id ?? ''}`);
        const { merchantId, importId, postId } = parsed.data;
        return this.runner.importAnyway(merchantId, importId, postId, { lastAttempt });
      }
      default:
        throw new UnrecoverableError(`Unknown job on ${IMPORTS_QUEUE}: ${job.name}`);
    }
  }
}
