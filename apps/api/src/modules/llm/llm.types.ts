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
