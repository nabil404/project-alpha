import { UnrecoverableError, type Job } from 'bullmq';
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

  /** A processor whose ingest records what it is handed. */
  function recordingProcessor() {
    const handled: InboundMessageJob[] = [];
    const processor = new InboundMessageProcessor({
      handle: async (job: InboundMessageJob) => {
        handled.push(job);
        return 'stored';
      },
    } as unknown as InboundMessageIngest);
    return { processor, handled };
  }

  const jobOf = (name: string, jobData: unknown) =>
    ({ id: 'mid-1', name, data: jobData }) as Job<InboundMessageJob>;

  it('hands inbound messages to the ingest', async () => {
    const { processor, handled } = recordingProcessor();

    await expect(processor.process(jobOf(INBOUND_MESSAGE_JOB, data))).resolves.toBe('stored');
    expect(handled).toEqual([data]);
  });

  it('hands a page echo to the ingest', async () => {
    const { processor, handled } = recordingProcessor();
    const echo: InboundMessageJob = {
      kind: 'page-echo',
      messageId: 'mid-2',
      pageId: '1',
      recipientPsid: 'psid-1',
      text: 'on its way',
      sentAt: 0,
      appId: '42',
    };

    await expect(processor.process(jobOf(INBOUND_MESSAGE_JOB, echo))).resolves.toBe('stored');
    expect(handled).toEqual([echo]);
  });

  it('reads a job queued before messages had a kind as a customer message', async () => {
    const { processor, handled } = recordingProcessor();
    const legacy = {
      messageId: 'mid-1',
      pageId: '1',
      senderPsid: 'psid-1',
      text: 'hi',
      sentAt: 0,
    };

    await expect(processor.process(jobOf(INBOUND_MESSAGE_JOB, legacy))).resolves.toBe('stored');
    expect(handled).toEqual([data]);
  });

  it('fails a malformed job once instead of retrying it', async () => {
    const { processor, handled } = recordingProcessor();
    const malformed = [
      { ...data, senderPsid: undefined },
      { ...data, kind: 'page-echo' },
      { ...data, kind: 'reaction' },
      { messageId: 'mid-1' },
      null,
    ];

    for (const jobData of malformed) {
      await expect(processor.process(jobOf(INBOUND_MESSAGE_JOB, jobData))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    }
    expect(handled).toEqual([]);
  });

  it('keeps message text out of the failure', async () => {
    const { processor } = recordingProcessor();
    const error = await processor
      .process(jobOf(INBOUND_MESSAGE_JOB, { ...data, text: 'secret words', sentAt: 'soon' }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).not.toContain('secret words');
  });

  it('fails a job it does not know once, without retrying', async () => {
    const { processor, handled } = recordingProcessor();
    const error = await processor.process(jobOf('something-else', data)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toMatch(/something-else/);
    expect(handled).toEqual([]);
  });
});
