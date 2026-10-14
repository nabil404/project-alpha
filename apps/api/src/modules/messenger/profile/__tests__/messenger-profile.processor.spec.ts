import type { Queue } from 'bullmq';
import type { Database } from '../../../database/database.module';
import { RESUBSCRIBE_PAGES_JOB } from '../../../queue/queue.constants';
import type { FacebookPageRepository } from '../../page/facebook-page.repository';
import { MessengerProfileProcessor } from '../messenger-profile.processor';
import type { MessengerProfileSync } from '../messenger-profile.sync';

describe('MessengerProfileProcessor', () => {
  it('queues the one-off resubscribe with retries that ride out a deploy-time outage', async () => {
    const added: { name: string; data: unknown; opts: unknown }[] = [];
    const queue = {
      add: async (name: string, data: unknown, opts: unknown) => {
        added.push({ name, data, opts });
      },
    } as unknown as Queue;
    const processor = new MessengerProfileProcessor(
      queue,
      {} as MessengerProfileSync,
      {} as Database,
      {} as FacebookPageRepository,
    );

    await processor.onApplicationBootstrap();

    expect(added).toEqual([
      {
        name: RESUBSCRIBE_PAGES_JOB,
        data: {},
        opts: {
          jobId: 'resubscribe-pages-v1',
          removeOnComplete: false,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      },
    ]);
  });
});
