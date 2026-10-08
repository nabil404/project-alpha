import { jest } from '@jest/globals';
import type { Queue } from 'bullmq';
import {
  CUSTOMER_WAITING_DELAY_MS,
  CUSTOMER_WAITING_JOB,
  EVENT_JOB_RETENTION,
  ORDER_DRAFTED_JOB,
} from '../../queue/queue.constants';
import { NotificationsService } from '../notifications.service';

describe('NotificationsService', () => {
  const add = jest.fn();
  const service = new NotificationsService({ add } as unknown as Queue);

  beforeEach(() => add.mockReset());

  it('queues a drafted order under an id the order makes', async () => {
    await service.orderDrafted('m-1', 'order-1');

    expect(add).toHaveBeenCalledWith(
      ORDER_DRAFTED_JOB,
      { merchantId: 'm-1', orderId: 'order-1' },
      { ...EVENT_JOB_RETENTION, jobId: 'order-drafted-order-1' },
    );
  });

  it('delays a handoff and names it by conversation and moment', async () => {
    const at = new Date('2026-10-07T10:00:00Z');

    await service.handedOff('m-1', 'conv-1', at);

    expect(add).toHaveBeenCalledWith(
      CUSTOMER_WAITING_JOB,
      { merchantId: 'm-1', conversationId: 'conv-1', handedOffAt: at.getTime() },
      {
        ...EVENT_JOB_RETENTION,
        jobId: `customer-waiting-conv-1-${at.getTime()}`,
        delay: CUSTOMER_WAITING_DELAY_MS,
      },
    );
  });

  it('keeps event jobs by age alone, so their ids dedupe past a busy hour', () => {
    expect(EVENT_JOB_RETENTION.removeOnComplete).toEqual({ age: 7 * 24 * 3_600 });
  });

  it('never puts a colon in a job id, which BullMQ refuses', async () => {
    await service.orderDrafted('m-1', 'order-1');
    await service.handedOff('m-1', 'conv-1', new Date());

    for (const [, , opts] of add.mock.calls as [string, unknown, { jobId: string }][]) {
      expect(opts.jobId).not.toContain(':');
    }
  });
});
