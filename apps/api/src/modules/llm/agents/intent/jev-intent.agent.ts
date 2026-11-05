import { Logger } from '@nestjs/common';
import { intentResultSchema, type IntentResult } from '@app/shared';
import { APIError, type TypeSafeClient } from '@typesafe-ai/sdk';
import type { LlmFailure, LlmResult } from '../../llm.types';
import type { IntentAgent, IntentInput } from './intent.agent';
import { CLASSIFY_INTENT_QUESTION, classifyIntentState } from './jev-intent.prompt';

export interface JevIntentOptions {
  client: Pick<TypeSafeClient, 'systemOne'>;
  /** A versioned id, so the confidence floor stays tuned to the model that answers. */
  model: string;
  timeoutMs: number;
}

/**
 * Intent through TypeSafe's Jev: one Choice over the intents. `confidence` is
 * the chosen intent's probability, which the state machine compares with its
 * floor; Jev's own `confidence` measures how peaked the answer is, not how
 * likely it is right. Never throws, and logs no chat or answer.
 */
export class JevIntentAgent implements IntentAgent {
  readonly purpose = 'classify' as const;
  private readonly logger = new Logger('JevIntentAgent');

  constructor(private readonly options: JevIntentOptions) {}

  async run({ history, pack }: IntentInput): Promise<LlmResult<IntentResult>> {
    const { client, model, timeoutMs } = this.options;
    const started = performance.now();
    const signal = AbortSignal.timeout(timeoutMs);
    const usage = (
      answeredBy: string,
      tokens?: { input_tokens: number | null; output_tokens: number | null },
    ) => ({
      purpose: this.purpose,
      model: answeredBy,
      inputTokens: tokens?.input_tokens ?? null,
      outputTokens: tokens?.output_tokens ?? null,
      latencyMs: Math.round(performance.now() - started),
      promptPack: pack.id,
    });
    try {
      const result = await client.systemOne(
        {
          model,
          state: classifyIntentState(history, pack),
          questions: { intent: CLASSIFY_INTENT_QUESTION },
        },
        { signal, retry: { maxRetries: 1 } },
      );
      const { choice, probabilities } = result.answers.intent;
      const parsed = intentResultSchema.safeParse({
        intent: choice,
        confidence: probabilities[choice],
      });
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_output', usage: usage(result.model, result.usage) };
      }
      return { ok: true, value: parsed.data, usage: usage(result.model, result.usage) };
    } catch (error) {
      const reason: LlmFailure = signal.aborted ? 'timeout' : 'provider_error';
      const result = { ok: false as const, reason, usage: usage(model) };
      const status = error instanceof APIError ? ` ${error.status}` : '';
      const name = error instanceof Error ? ` (${error.name}${status})` : '';
      this.logger.warn(
        `Jev classify on ${model} failed: ${reason}${name} after ${result.usage.latencyMs}ms`,
      );
      return result;
    }
  }
}
