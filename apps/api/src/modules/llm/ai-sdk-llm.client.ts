import { Logger } from '@nestjs/common';
import { generateText, Output, RetryError, type LanguageModel } from 'ai';
import {
  extractedOrderSchema,
  intentResultSchema,
  type CollectedSlots,
  type ExtractedOrder,
  type IntentResult,
} from '@app/shared';
import type { z } from 'zod';
import { CLASSIFY_INTENT_SYSTEM } from './prompts/classify-intent';
import { EXTRACT_ORDER_SYSTEM, extractOrderPrompt } from './prompts/extract-order';
import { PHRASE_REPLY_SYSTEM, phraseReplyPrompt } from './prompts/phrase-reply';
import { transcript } from './prompts/transcript';
import type {
  ChatLine,
  LlmClient,
  LlmFailure,
  LlmPurpose,
  LlmResult,
  PhraseRequest,
} from './llm.types';

type Model = Exclude<LanguageModel, string>;

export interface AiSdkLlmOptions {
  routing: Model;
  extraction: Model;
  timeoutMs: number;
}

interface Tokens {
  inputTokens?: number;
  outputTokens?: number;
}

/** Structured output that parsed as JSON but broke a bound the provider's strict mode does not enforce. */
class InvalidOutput extends Error {
  override name = 'InvalidOutput';
}

const INVALID_OUTPUT_ERRORS = new Set([
  'InvalidOutput',
  'AI_NoObjectGeneratedError',
  'AI_NoOutputGeneratedError',
  'AI_JSONParseError',
  'AI_TypeValidationError',
]);

/**
 * The assistant's LLM calls through the AI SDK. Never throws: every failure
 * is a result the state machine turns into a hand-off. Logs only the purpose,
 * outcome, model and latency, never the chat or the output.
 */
export class AiSdkLlmClient implements LlmClient {
  private readonly logger = new Logger('LlmClient');

  constructor(private readonly options: AiSdkLlmOptions) {}

  classifyIntent(history: ChatLine[]): Promise<LlmResult<IntentResult>> {
    return this.object(
      'classify',
      this.options.routing,
      intentResultSchema,
      CLASSIFY_INTENT_SYSTEM,
      transcript(history),
    );
  }

  extractOrder(history: ChatLine[], slots: CollectedSlots): Promise<LlmResult<ExtractedOrder>> {
    return this.object(
      'extract',
      this.options.extraction,
      extractedOrderSchema,
      EXTRACT_ORDER_SYSTEM,
      extractOrderPrompt(history, slots),
    );
  }

  phraseReply(request: PhraseRequest, history: ChatLine[]): Promise<LlmResult<string>> {
    const model = this.options.routing;
    return this.call('phrase', model, async (abortSignal) => {
      const result = await generateText({
        model,
        system: PHRASE_REPLY_SYSTEM,
        prompt: phraseReplyPrompt(request, history),
        abortSignal,
        maxRetries: 1,
      });
      return { value: result.text.trim(), tokens: result.usage };
    });
  }

  private object<S extends z.ZodType>(
    purpose: LlmPurpose,
    model: Model,
    schema: S,
    system: string,
    prompt: string,
  ): Promise<LlmResult<z.infer<S>>> {
    return this.call(purpose, model, async (abortSignal) => {
      const result = await generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema }),
        abortSignal,
        maxRetries: 1,
      });
      // Again with Zod: strict JSON-schema mode can drop bounds such as confidence's 0..1.
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) throw new InvalidOutput();
      return { value: parsed.data as z.infer<S>, tokens: result.usage };
    });
  }

  private async call<T>(
    purpose: LlmPurpose,
    model: Model,
    run: (abortSignal: AbortSignal) => Promise<{ value: T; tokens: Tokens }>,
  ): Promise<LlmResult<T>> {
    const started = performance.now();
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const usage = (tokens?: Tokens) => ({
      purpose,
      model: model.modelId,
      inputTokens: tokens?.inputTokens ?? null,
      outputTokens: tokens?.outputTokens ?? null,
      latencyMs: Math.round(performance.now() - started),
    });
    try {
      const { value, tokens } = await run(signal);
      return { ok: true, value, usage: usage(tokens) };
    } catch (error) {
      const reason = failureOf(error, signal);
      const result = { ok: false as const, reason, usage: usage() };
      this.logger.warn(
        `LLM ${purpose} on ${model.modelId} failed: ${reason} after ${result.usage.latencyMs}ms`,
      );
      return result;
    }
  }
}

function failureOf(error: unknown, signal: AbortSignal): LlmFailure {
  if (signal.aborted) return 'timeout';
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (cause instanceof Error && INVALID_OUTPUT_ERRORS.has(cause.name)) return 'invalid_output';
  return 'provider_error';
}
