import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import {
  ASSISTANT_CONCURRENCY,
  ASSISTANT_QUEUE,
  ASSISTANT_TURN_JOB,
  type AssistantTurnJob,
} from '../../queue/queue.constants';
import { AssistantTurnService, type TurnOutcome } from './assistant-turn.service';

const assistantTurnJobSchema = z.object({
  merchantId: z.string().min(1),
  conversationId: z.string().min(1),
  triggerMessageId: z.string().min(1),
});

/** Registered only in WorkerModule, through AssistantModule. */
@Processor(ASSISTANT_QUEUE, { concurrency: ASSISTANT_CONCURRENCY })
export class AssistantTurnProcessor extends WorkerHost {
  constructor(private readonly turns: AssistantTurnService) {
    super();
  }

  /** A job that cannot be read fails once: a retry would read it the same way. */
  async process(job: Job<AssistantTurnJob>): Promise<TurnOutcome> {
    if (job.name !== ASSISTANT_TURN_JOB) {
      throw new UnrecoverableError(`Unknown job on ${ASSISTANT_QUEUE}: ${job.name}`);
    }
    const parsed = assistantTurnJobSchema.safeParse(job.data);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
      throw new UnrecoverableError(
        `Malformed ${ASSISTANT_TURN_JOB} job ${job.id ?? ''} on ${ASSISTANT_QUEUE}: ${fields.join(', ')}`,
      );
    }
    return this.turns.run(parsed.data);
  }
}
