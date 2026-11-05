/** What each call was for; one row per call in llm_call. */
export const LLM_PURPOSES = [
  'classify',
  'extract',
  'phrase',
  'vision_match',
  'post_import',
  'answer',
] as const;
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
  /** The region's prompt (`PromptPack.id`); null for a call whose prompt has no region. */
  promptPack: string | null;
}

export type LlmCallRecord = LlmUsage & { outcome: LlmOutcome };

/** Every call answers; none throws. */
export type LlmResult<T> =
  { ok: true; value: T; usage: LlmUsage } | { ok: false; reason: LlmFailure; usage: LlmUsage };

export interface ChatLine {
  from: 'customer' | 'shop' | 'assistant';
  text: string;
}
