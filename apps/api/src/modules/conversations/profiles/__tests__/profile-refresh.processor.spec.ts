import { jest } from '@jest/globals';
import type { Job, Queue } from 'bullmq';
import { REFRESH_PROFILES_JOB } from '../../../queue/queue.constants';
import type { CustomerProfileRefresh } from '../customer-profile-refresh';
import { ProfileRefreshProcessor } from '../profile-refresh.processor';

describe('ProfileRefreshProcessor', () => {
  const report = { merchants: 1, abortedMerchants: 0, read: 3, failed: 0, aborted: false };
  const refresh = { refreshAll: jest.fn(async () => report) };
  const processor = new ProfileRefreshProcessor(
    {} as Queue,
    refresh as unknown as CustomerProfileRefresh,
  );

  it('refreshes every shop on its job', async () => {
    await expect(processor.process({ name: REFRESH_PROFILES_JOB } as Job)).resolves.toEqual(report);
    expect(refresh.refreshAll).toHaveBeenCalledTimes(1);
  });

  it('refuses a job it does not know', async () => {
    await expect(processor.process({ name: 'something-else' } as Job)).rejects.toThrow(
      /something-else/,
    );
  });

  it('schedules itself once, by id, so every worker boot updates the same scheduler', async () => {
    const upsertJobScheduler = jest.fn(async () => undefined);
    await new ProfileRefreshProcessor(
      { upsertJobScheduler } as unknown as Queue,
      refresh as unknown as CustomerProfileRefresh,
    ).onApplicationBootstrap();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'refresh-stale-profiles-daily',
      { pattern: '0 4 * * *' },
      { name: REFRESH_PROFILES_JOB },
    );
  });
});
