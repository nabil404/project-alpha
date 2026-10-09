import { UnrecoverableError, type Job } from 'bullmq';
import { ASSISTANT_TURN_JOB, type AssistantTurnJob } from '../../../queue/queue.constants';
import { AssistantTurnProcessor } from '../assistant-turn.processor';
import type { AssistantTurnService } from '../assistant-turn.service';

const job = (name: string, data: unknown) => ({ id: '1', name, data }) as Job<AssistantTurnJob>;

describe('AssistantTurnProcessor', () => {
  const runs: AssistantTurnJob[] = [];
  const processor = new AssistantTurnProcessor({
    run: async (data: AssistantTurnJob) => {
      runs.push(data);
      return 'replied';
    },
  } as unknown as AssistantTurnService);
  const data = { merchantId: 'm1', conversationId: 'c1', triggerMessageId: 'x1' };

  it('runs a well-formed turn', async () => {
    await expect(processor.process(job(ASSISTANT_TURN_JOB, data))).resolves.toBe('replied');
    expect(runs).toEqual([data]);
  });

  it('fails an unknown job name or malformed data for good, naming fields only', async () => {
    await expect(processor.process(job('other', data))).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor.process(job(ASSISTANT_TURN_JOB, { merchantId: 'm1' }))).rejects.toThrow(
      /conversationId, triggerMessageId/,
    );
  });
});
