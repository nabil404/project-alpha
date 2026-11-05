import { Logger } from '@nestjs/common';
import type { AssistantTone } from '@app/shared';
import { generateText } from 'ai';
import type { ChatLine, LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { runLlmCall } from '../../runtime/run-llm-call';
import { MAX_RETRIES, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { phraseReplyPrompt, phraseReplySystem } from './reply-phrasing.prompt';

/** What to say, decided by code, and the only facts the reply may use. */
export interface PhraseRequest {
  instruction: string;
  facts: Record<string, unknown>;
  /** ISO 639-1: the reply language, or only the fallback when `matchCustomer`. */
  language: string;
  /** The seller chose "Match the customer": mirror the customer's language and script. */
  matchCustomer: boolean;
  /** The seller's choice in Settings > Order assistant. */
  tone: AssistantTone;
  /** The shop's region: the languages the customer may write in. */
  pack: PromptPack;
}

export interface ReplyPhrasingInput {
  request: PhraseRequest;
  /** The last few chat lines, for the customer's language and the flow. */
  history: ChatLine[];
}

/**
 * Writes one or two sentences that say what code told it to say. Its output
 * is only ever sent after `checkReply` passes it.
 */
export type ReplyPhrasingAgent = Agent<ReplyPhrasingInput, string>;

/** The `ReplyPhrasingAgent | null` provider: null without LLM_API_KEY. */
export const REPLY_PHRASING_AGENT = Symbol('REPLY_PHRASING_AGENT');

/** Phrasing through the routing model; plain text, trimmed. */
export class AiSdkReplyPhrasingAgent implements ReplyPhrasingAgent {
  readonly purpose = 'phrase' as const;
  private readonly logger = new Logger('ReplyPhrasingAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run({ request, history }: ReplyPhrasingInput): Promise<LlmResult<string>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      {
        purpose: this.purpose,
        modelId: model.modelId,
        pack: request.pack,
        timeoutMs,
        logger: this.logger,
      },
      async (abortSignal) => {
        const result = await generateText({
          model,
          system: phraseReplySystem(request.pack),
          prompt: phraseReplyPrompt(request, history),
          abortSignal,
          maxRetries: MAX_RETRIES,
          telemetry: telemetryFor(telemetry, this.purpose),
        });
        return { value: result.text.trim(), tokens: result.usage };
      },
    );
  }
}
