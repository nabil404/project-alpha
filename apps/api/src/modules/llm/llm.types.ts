import type { CollectedSlots, ExtractedOrder, IntentResult } from '@app/shared';

/** What each call was for; one row per call in llm_call. */
export const LLM_PURPOSES = ['classify', 'extract', 'phrase'] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export const LLM_OUTCOMES = ['ok', 'timeout', 'provider_error', 'invalid_output'] as const;
export type LlmOutcome = (typeof LLM_OUTCOMES)[number];
export type LlmFailure = Exclude<LlmOutcome, 'ok'>;

/** Tokens are null when the provider never answered. */
export interface LlmUsage {
  purpose: LlmPurpose;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export type LlmCallRecord = LlmUsage & { outcome: LlmOutcome };

/** The `LlmClient | null` provider: null when LLM_API_KEY is unset. */
export const LLM = Symbol('LLM');

/** Every call answers; none throws. */
export type LlmResult<T> =
  { ok: true; value: T; usage: LlmUsage } | { ok: false; reason: LlmFailure; usage: LlmUsage };

export interface ChatLine {
  from: 'customer' | 'shop' | 'assistant';
  text: string;
}

/** What to say, decided by code, and the only facts the reply may use. */
export interface PhraseRequest {
  instruction: string;
  facts: Record<string, string | number>;
  /** Used when the customer's own language is unclear. */
  language: 'bn' | 'en';
}

export interface LlmClient {
  classifyIntent(history: ChatLine[]): Promise<LlmResult<IntentResult>>;
  extractOrder(history: ChatLine[], slots: CollectedSlots): Promise<LlmResult<ExtractedOrder>>;
  phraseReply(request: PhraseRequest, history: ChatLine[]): Promise<LlmResult<string>>;
}
