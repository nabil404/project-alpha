import type { LlmPurpose, LlmResult } from '../llm.types';

/**
 * One LLM job: one prompt, one output schema, one model tier, one `purpose`
 * on `llm_call`. Code calls it, checks what it returns and decides what
 * happens next; an agent never chooses an action, never sees a catalog id
 * and never confirms anything. `run` never throws: every failure is a result.
 */
export interface Agent<I, O> {
  readonly purpose: LlmPurpose;
  run(input: I): Promise<LlmResult<O>>;
}
