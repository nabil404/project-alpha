import { jest } from '@jest/globals';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { MailService } from '../../mail/mail.service';
import {
  CUSTOMER_WAITING_JOB,
  DAILY_SUMMARY_JOB,
  DAILY_SUMMARY_SCAN_JOB,
  ORDER_DRAFTED_JOB,
  SEND_EMAIL_JOB,
} from '../../queue/queue.constants';
import type { NotificationComposer, NotificationEmail } from '../notification-composer';
import { NotificationsProcessor } from '../notifications.processor';

const email = (userId: string): NotificationEmail => ({
  userId,
  message: { to: `${userId}@example.test`, subject: 'S', text: 'T', html: '<p>T</p>' },
});

describe('NotificationsProcessor', () => {
  const addBulk = jest.fn();
  const upsertJobScheduler = jest.fn();
  const send = jest.fn<MailService['send']>();
  const composer = {
    orderDrafted: jest.fn<NotificationComposer['orderDrafted']>(),
    customerWaiting: jest.fn<NotificationComposer['customerWaiting']>(),
    dailySummariesDue: jest.fn<NotificationComposer['dailySummariesDue']>(),
    dailySummary: jest.fn<NotificationComposer['dailySummary']>(),
  };
  const processor = new NotificationsProcessor(
    { addBulk, upsertJobScheduler } as unknown as Queue,
    composer as unknown as NotificationComposer,
    { send } as unknown as MailService,
  );
  const job = (name: string, id: string, data: unknown) => ({ name, id, data }) as Job;

  beforeEach(() => jest.clearAllMocks());

  it('schedules the daily scan once, in UTC', async () => {
    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'daily-summary-scan',
      { pattern: '*/15 * * * *', tz: 'UTC' },
      { name: DAILY_SUMMARY_SCAN_JOB },
    );
  });

  it('queues one send per recipient, named by the event and the person', async () => {
    composer.orderDrafted.mockResolvedValue([email('u1'), email('u2')]);

    const result = await processor.process(
      job(ORDER_DRAFTED_JOB, 'order-drafted-o1', { merchantId: 'm', orderId: 'o1' }),
    );

    expect(composer.orderDrafted).toHaveBeenCalledWith('m', 'o1');
    expect(result).toEqual({ queued: 2 });
    expect(addBulk).toHaveBeenCalledWith([
      { name: SEND_EMAIL_JOB, data: email('u1').message, opts: { jobId: 'order-drafted-o1-u1' } },
      { name: SEND_EMAIL_JOB, data: email('u2').message, opts: { jobId: 'order-drafted-o1-u2' } },
    ]);
  });

  it('passes the handoff moment back as a Date', async () => {
    composer.customerWaiting.mockResolvedValue([]);
    const at = Date.parse('2026-10-07T10:00:00Z');

    await processor.process(
      job(CUSTOMER_WAITING_JOB, 'cw', { merchantId: 'm', conversationId: 'c', handedOffAt: at }),
    );

    expect(composer.customerWaiting).toHaveBeenCalledWith('m', 'c', new Date(at));
    expect(addBulk).toHaveBeenCalledWith([]);
  });

  it('fans the scan out to one summary job per shop and day', async () => {
    composer.dailySummariesDue.mockResolvedValue([
      { merchantId: 'm1', day: '2026-10-06' },
      { merchantId: 'm2', day: '2026-10-06' },
    ]);

    await expect(processor.process(job(DAILY_SUMMARY_SCAN_JOB, 's', {}))).resolves.toEqual({
      queued: 2,
    });

    expect(addBulk).toHaveBeenCalledWith([
      {
        name: DAILY_SUMMARY_JOB,
        data: { merchantId: 'm1', day: '2026-10-06' },
        opts: { jobId: 'daily-summary-m1-2026-10-06' },
      },
      {
        name: DAILY_SUMMARY_JOB,
        data: { merchantId: 'm2', day: '2026-10-06' },
        opts: { jobId: 'daily-summary-m2-2026-10-06' },
      },
    ]);
  });

  it('writes the summary for the job day', async () => {
    composer.dailySummary.mockResolvedValue([email('u1')]);

    await processor.process(
      job(DAILY_SUMMARY_JOB, 'daily-summary-m-2026-10-06', { merchantId: 'm', day: '2026-10-06' }),
    );

    expect(composer.dailySummary).toHaveBeenCalledWith('m', '2026-10-06');
  });

  it('lets a failed send throw, so BullMQ retries that one message', async () => {
    send.mockRejectedValue(new Error('SMTP down'));

    await expect(
      processor.process(job(SEND_EMAIL_JOB, 'x-u1', email('u1').message)),
    ).rejects.toThrow('SMTP down');
  });

  it('refuses an unknown job without retrying it', async () => {
    await expect(processor.process(job('nope', 'n', {}))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
