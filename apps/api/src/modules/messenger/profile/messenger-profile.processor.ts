import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { DATABASE, type Database } from '../../database/database.module';
import {
  MESSENGER_PROFILE_QUEUE,
  RESUBSCRIBE_PAGES_JOB,
  SYNC_PROFILE_JOB,
  type SyncProfileJob,
} from '../../queue/queue.constants';
import { FacebookPageRepository } from '../page/facebook-page.repository';
import { MessengerProfileSync } from './messenger-profile.sync';

/**
 * Registered only in WorkerModule: the API boots AppModule too, and a processor
 * there would consume jobs in the HTTP process.
 */
@Processor(MESSENGER_PROFILE_QUEUE)
export class MessengerProfileProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(MESSENGER_PROFILE_QUEUE) private readonly queue: Queue,
    private readonly sync: MessengerProfileSync,
    @Inject(DATABASE) private readonly db: Database,
    private readonly pages: FacebookPageRepository,
  ) {
    super();
  }

  /**
   * Pages connected before messaging_referrals was added still have the old
   * field list. Runs once: its id is fixed, so BullMQ ignores the add while the
   * last one is retained. Bump the job id (e.g. -v2) to run it again for a new
   * webhook field.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      RESUBSCRIBE_PAGES_JOB,
      {},
      { jobId: 'resubscribe-pages-v1', removeOnComplete: false },
    );
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === SYNC_PROFILE_JOB) return this.sync.run(job.data as SyncProfileJob);
    if (job.name === RESUBSCRIBE_PAGES_JOB) {
      for (const merchantId of await this.pages.listConnectedMerchantIds(this.db)) {
        await this.sync.request(merchantId, { resubscribe: true });
      }
      return 'queued';
    }
    throw new UnrecoverableError(`Unknown job on ${MESSENGER_PROFILE_QUEUE}: ${job.name}`);
  }
}
