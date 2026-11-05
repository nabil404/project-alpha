import { Logger } from '@nestjs/common';
import { intentResultSchema, type IntentResult } from '@app/shared';
import type { ChatLine, LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { transcript } from '../../prompts/transcript';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { classifyIntentSystem } from './intent.prompt';

export interface IntentInput {
  history: ChatLine[];
  pack: PromptPack;
}

/** Names what the customer's latest message is about. */
export type IntentAgent = Agent<IntentInput, IntentResult>;

/** The `IntentAgent | null` provider: null without LLM_API_KEY. */
export const INTENT_AGENT = Symbol('INTENT_AGENT');

/** Intent through the routing model (LLM_INTENT_PROVIDER=openai). */
export class AiSdkIntentAgent implements IntentAgent {
  readonly purpose = 'classify' as const;
  private readonly logger = new Logger('IntentAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run({ history, pack }: IntentInput): Promise<LlmResult<IntentResult>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      { purpose: this.purpose, modelId: model.modelId, pack, timeoutMs, logger: this.logger },
      (abortSignal) =>
        generateStructured({
          model,
          system: classifyIntentSystem(pack),
          prompt: transcript(history),
          schema: intentResultSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
        }),
    );
  }
}
