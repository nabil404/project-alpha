import type { Job } from 'bullmq';
import { INBOUND_MESSAGE_JOB, type InboundMessageJob } from '../../../queue/queue.constants';
import type { InboundMessageIngest } from '../inbound-message.ingest';
import { InboundMessageProcessor } from '../inbound-message.processor';

describe('InboundMessageProcessor', () => {
  const data: InboundMessageJob = {
    kind: 'customer-message',
    messageId: 'mid-1',
    pageId: '1',
    senderPsid: 'psid-1',
    text: 'hi',
    sentAt: 0,
  };

  it('hands inbound messages to the ingest', async () => {
    const handled: InboundMessageJob[] = [];
    const processor = new InboundMessageProcessor({
      handle: async (job: InboundMessageJob) => {
        handled.push(job);
        return 'stored';
      },
    } as unknown as InboundMessageIngest);

    await expect(
      processor.process({ name: INBOUND_MESSAGE_JOB, data } as Job<InboundMessageJob>),
    ).resolves.toBe('stored');
    expect(handled).toEqual([data]);
  });

  it('refuses a job it does not know', async () => {
    const processor = new InboundMessageProcessor({} as InboundMessageIngest);
    await expect(
      processor.process({ name: 'something-else', data } as Job<InboundMessageJob>),
    ).rejects.toThrow(/something-else/);
  });
});
