import { type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { PROFILE_QUEUE, REFRESH_PROFILES_JOB } from '../../queue/queue.constants';
import { CustomerProfileRefresh, type ProfileRefreshReport } from './customer-profile-refresh';

/** Daily at 04:00 UTC, an hour after the image sweep. */
const REFRESH_SCHEDULE = '0 4 * * *';
const REFRESH_SCHEDULER_ID = 'refresh-stale-profiles-daily';

/**
 * Registered only in WorkerModule: the API boots AppModule too, and a processor
 * there would consume jobs in the HTTP process.
 */
@Processor(PROFILE_QUEUE)
export class ProfileRefreshProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(PROFILE_QUEUE) private readonly queue: Queue,
    private readonly refresh: CustomerProfileRefresh,
  ) {
    super();
  }

  /** Idempotent: every worker boot updates the one scheduler instead of adding another. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REFRESH_SCHEDULER_ID,
      { pattern: REFRESH_SCHEDULE },
      { name: REFRESH_PROFILES_JOB },
    );
  }

  async process(job: Job): Promise<ProfileRefreshReport> {
    if (job.name !== REFRESH_PROFILES_JOB) {
      throw new UnrecoverableError(`Unknown job on ${PROFILE_QUEUE}: ${job.name}`);
    }
    return this.refresh.refreshAll();
  }
}
