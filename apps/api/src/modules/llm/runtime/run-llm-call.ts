import type { Logger } from '@nestjs/common';
import { RetryError } from 'ai';
import type { PromptPack } from '../prompts/prompt-pack';
import type { LlmFailure, LlmPurpose, LlmResult, LlmUsage } from '../llm.types';

/** Token counts as the AI SDK reports them; either may be missing. */
export interface Tokens {
  inputTokens?: number;
  outputTokens?: number;
}

/** Structured output that parsed as JSON but broke a bound the provider's strict mode does not enforce. */
export class InvalidOutput extends Error {
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

export interface LlmCall {
  purpose: LlmPurpose;
  /** The id of the model that answers, stored on `llm_call`. */
  modelId: string;
  /** The region's prompt; null for a call whose prompt has no region. */
  pack: PromptPack | null;
  timeoutMs: number;
  logger: Logger;
}

/**
 * Runs one provider call under the timeout and turns every failure into a
 * result, so no agent throws. Logs only the purpose, outcome, model, error
 * name, HTTP status and latency, never the chat, the prompt or the output.
 */
export async function runLlmCall<T>(
  call: LlmCall,
  run: (abortSignal: AbortSignal) => Promise<{ value: T; tokens: Tokens }>,
): Promise<LlmResult<T>> {
  const started = performance.now();
  const signal = AbortSignal.timeout(call.timeoutMs);
  const usage = (tokens?: Tokens): LlmUsage => ({
    purpose: call.purpose,
    model: call.modelId,
    inputTokens: tokens?.inputTokens ?? null,
    outputTokens: tokens?.outputTokens ?? null,
    latencyMs: Math.round(performance.now() - started),
    promptPack: call.pack?.id ?? null,
  });
  try {
    const { value, tokens } = await run(signal);
    return { ok: true, value, usage: usage(tokens) };
  } catch (error) {
    const reason = failureOf(error, signal);
    const result = { ok: false as const, reason, usage: usage(billedTokens(error)) };
    call.logger.warn(
      `LLM ${call.purpose} on ${call.modelId} failed: ${reason}${describe(error)} after ${result.usage.latencyMs}ms`,
    );
    return result;
  }
}

function failureOf(error: unknown, signal: AbortSignal): LlmFailure {
  if (signal.aborted) return 'timeout';
  const cause = causeOf(error);
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
