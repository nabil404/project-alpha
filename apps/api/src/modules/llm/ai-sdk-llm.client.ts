import { Logger } from '@nestjs/common';
import {
  generateText,
  Output,
  RetryError,
  type LanguageModel,
  type Telemetry,
  type TelemetryOptions,
} from 'ai';
import {
  extractedOrderSchema,
  intentResultSchema,
  photoMatchSchema,
  postProductsSchema,
  type ExtractedOrder,
  type IntentResult,
  type PhotoMatch,
  type PostProducts,
} from '@app/shared';
import type { z } from 'zod';
import type { IntentClassifier } from './jev-intent.classifier';
import { classifyIntentSystem } from './prompts/classify-intent';
import { extractOrderPrompt, extractOrderSystem } from './prompts/extract-order';
import {
  extractProductsFromPostContent,
  extractProductsFromPostSystem,
} from './prompts/extract-products-from-post';
import {
  MATCH_PRODUCT_PHOTO_SYSTEM,
  matchProductPhotoContent,
} from './prompts/match-product-photo';
import { phraseReplyPrompt, phraseReplySystem } from './prompts/phrase-reply';
import type { PromptPack } from './prompts/prompt-pack';
import { transcript } from './prompts/transcript';
import type {
  ChatLine,
  ExtractionContext,
  LlmClient,
  LlmFailure,
  LlmPurpose,
  LlmResult,
  PhotoMatchRequest,
  PhraseRequest,
  PostExtractionRequest,
} from './llm.types';

type Model = Exclude<LanguageModel, string>;

export interface AiSdkLlmOptions {
  routing: Model;
  extraction: Model;
  timeoutMs: number;
  /** Classifies intent in place of the routing model (LLM_INTENT_PROVIDER=jev). */
  intent?: IntentClassifier;
  /** Traces every call, named by its purpose; absent, telemetry is off for every call. */
  telemetry?: Telemetry;
}

interface Tokens {
  inputTokens?: number;
  outputTokens?: number;
}

/** Structured output that parsed as JSON but broke a bound the provider's strict mode does not enforce. */
class InvalidOutput extends Error {
  override name = 'InvalidOutput';
  constructor(readonly tokens: Tokens) {
    super('invalid output');
  }
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

  classifyIntent(history: ChatLine[], pack: PromptPack): Promise<LlmResult<IntentResult>> {
    if (this.options.intent) return this.options.intent.classifyIntent(history, pack);
    return this.object(
      'classify',
      this.options.routing,
      pack,
      intentResultSchema,
      classifyIntentSystem(pack),
      transcript(history),
    );
  }

  extractOrder(
    history: ChatLine[],
    context: ExtractionContext,
    pack: PromptPack,
  ): Promise<LlmResult<ExtractedOrder>> {
    return this.object(
      'extract',
      this.options.extraction,
      pack,
      extractedOrderSchema,
      extractOrderSystem(pack),
      extractOrderPrompt(history, context),
    );
  }

  phraseReply(request: PhraseRequest, history: ChatLine[]): Promise<LlmResult<string>> {
    const model = this.options.routing;
    return this.call('phrase', model, request.pack, async (abortSignal) => {
      const result = await generateText({
        model,
        system: phraseReplySystem(request.pack),
        prompt: phraseReplyPrompt(request, history),
        abortSignal,
        maxRetries: 1,
        telemetry: this.telemetry('phrase'),
      });
      return { value: result.text.trim(), tokens: result.usage };
    });
  }

  /** The larger model: it reads images, and a wrong match costs more than the call. */
  matchProductPhoto(request: PhotoMatchRequest): Promise<LlmResult<PhotoMatch>> {
    const model = this.options.extraction;
    return this.call('vision_match', model, null, async (abortSignal) => {
      const result = await generateText({
        model,
        system: MATCH_PRODUCT_PHOTO_SYSTEM,
        messages: [{ role: 'user', content: matchProductPhotoContent(request) }],
        output: Output.object({ schema: photoMatchSchema }),
        abortSignal,
        maxRetries: 1,
        telemetry: this.telemetry('vision_match'),
      });
      const parsed = photoMatchSchema.safeParse(result.output);
      if (!parsed.success) throw new InvalidOutput(result.usage);
      return { value: parsed.data, tokens: result.usage };
    });
  }

  /** The larger model: it reads the post's photos, prices written on them included. */
  extractProductsFromPost(request: PostExtractionRequest): Promise<LlmResult<PostProducts>> {
    const model = this.options.extraction;
    return this.call('post_import', model, request.pack, async (abortSignal) => {
      const result = await generateText({
        model,
        system: extractProductsFromPostSystem(request.pack),
        messages: [{ role: 'user', content: extractProductsFromPostContent(request) }],
        output: Output.object({ schema: postProductsSchema }),
        abortSignal,
        maxRetries: 1,
        telemetry: this.telemetry('post_import'),
      });
      const parsed = postProductsSchema.safeParse(result.output);
      if (!parsed.success) throw new InvalidOutput(result.usage);
      return { value: parsed.data, tokens: result.usage };
    });
  }

  private object<S extends z.ZodType>(
    purpose: LlmPurpose,
    model: Model,
    pack: PromptPack,
    schema: S,
    system: string,
    prompt: string,
  ): Promise<LlmResult<z.infer<S>>> {
    return this.call(purpose, model, pack, async (abortSignal) => {
      const result = await generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema }),
        abortSignal,
        maxRetries: 1,
        telemetry: this.telemetry(purpose),
      });
      // Again with Zod: strict JSON-schema mode can drop bounds such as confidence's 0..1.
      const parsed = schema.safeParse(result.output);
      if (!parsed.success) throw new InvalidOutput(result.usage);
      return { value: parsed.data as z.infer<S>, tokens: result.usage };
    });
  }

  private telemetry(purpose: LlmPurpose): TelemetryOptions {
    const { telemetry } = this.options;
    return telemetry ? { functionId: purpose, integrations: [telemetry] } : { isEnabled: false };
  }

  private async call<T>(
    purpose: LlmPurpose,
    model: Model,
    pack: PromptPack | null,
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
      promptPack: pack?.id ?? null,
    });
    try {
      const { value, tokens } = await run(signal);
      return { ok: true, value, usage: usage(tokens) };
    } catch (error) {
      const reason = failureOf(error, signal);
      const result = { ok: false as const, reason, usage: usage(billedTokens(error)) };
      this.logger.warn(
        `LLM ${purpose} on ${model.modelId} failed: ${reason}${describe(error)} after ${result.usage.latencyMs}ms`,
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

function causeOf(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

/** Tokens the provider billed for a call that still failed, when the error carries them. */
function billedTokens(error: unknown): Tokens | undefined {
  const cause = causeOf(error);
  if (cause instanceof InvalidOutput) return cause.tokens;
  const usage = (cause as { usage?: Tokens } | null)?.usage;
  return typeof usage === 'object' && usage !== null ? usage : undefined;
}

/** The error's name and HTTP status: enough to tell a 401 from a 429, with no message or body. */
function describe(error: unknown): string {
  const cause = causeOf(error);
  if (!(cause instanceof Error)) return '';
  const status = (cause as { statusCode?: unknown }).statusCode;
  return ` (${cause.name}${typeof status === 'number' ? ` ${status}` : ''})`;
}
