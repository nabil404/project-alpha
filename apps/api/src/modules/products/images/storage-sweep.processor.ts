import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { STORAGE_QUEUE, SWEEP_JOB } from '../../queue/queue.constants';
import { ObjectStorage } from '../../storage/object-storage';
import { ProductImageRepository } from './product-image.repository';
import { sweepOrphanedImages, type SweepReport } from './sweep-orphaned-images';

/** Daily at 03:00 UTC. */
const SWEEP_SCHEDULE = '0 3 * * *';
const SWEEP_SCHEDULER_ID = 'sweep-orphaned-images-daily';

/**
 * Registered only in WorkerModule: the API boots AppModule too, and a processor
 * there would consume jobs in the HTTP process.
 */
@Processor(STORAGE_QUEUE)
export class StorageSweepProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageSweepProcessor.name);

  constructor(
    @InjectQueue(STORAGE_QUEUE) private readonly queue: Queue,
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly repository: ProductImageRepository,
  ) {
    super();
  }

  /** Idempotent: every worker boot updates the one scheduler instead of adding another. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { pattern: SWEEP_SCHEDULE },
      { name: SWEEP_JOB },
    );
  }

  async process(job: Job): Promise<SweepReport> {
    if (job.name !== SWEEP_JOB) {
      throw new Error(`Unknown job on ${STORAGE_QUEUE}: ${job.name}`);
    }

    const report = await sweepOrphanedImages({
      storage: this.storage,
      now: () => new Date(),
      existingImageIds: (merchantId, imageIds) =>
        withMerchant(this.db, merchantId, (tx) =>
          this.repository.existingIds(tx, { merchantId }, imageIds),
        ),
    });

    if (report.aborted) {
      this.logger.error(
        `Orphan sweep aborted by its circuit breaker: ${report.orphans} of ${report.examined} objects would have been deleted`,
      );
    } else {
      this.logger.log(
        `Orphan sweep deleted ${report.deleted} of ${report.examined} objects (${report.skipped} unparseable keys skipped)`,
      );
    }
    return report;
  }
}
