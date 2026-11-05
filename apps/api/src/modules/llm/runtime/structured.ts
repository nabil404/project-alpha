import {
  generateText,
  Output,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type Telemetry,
  type TelemetryOptions,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';
import type { LlmPurpose } from '../llm.types';
import { InvalidOutput, type Tokens } from './run-llm-call';

/** A model instance, never a bare id string: agents read `modelId` for `llm_call`. */
export type Model = Exclude<LanguageModel, string>;

/** What every AI SDK agent is built with. */
export interface AiSdkAgentOptions {
  model: Model;
  timeoutMs: number;
  /** Traces every call, named by its purpose; absent, telemetry is off for the call. */
  telemetry?: Telemetry;
}

/** The AI SDK retries once inside the timeout. */
export const MAX_RETRIES = 1;

/** Traces under the purpose with the given integration, or turns telemetry off, global ones included. */
export function telemetryFor(
  telemetry: Telemetry | undefined,
  purpose: LlmPurpose,
): TelemetryOptions {
  return telemetry ? { functionId: purpose, integrations: [telemetry] } : { isEnabled: false };
}

type StructuredInput = { prompt: string } | { messages: ModelMessage[] };

/**
 * Read-only lookups the model may call before it answers, and how many
 * model steps the call may take in all. The last step offers no tools, so
 * the call always ends in the schema's JSON.
 */
export interface Lookups {
  tools: ToolSet;
  maxSteps: number;
}

/**
 * Asks for JSON that fits the schema, then parses it with Zod again, because
 * strict JSON-schema mode can drop bounds such as confidence's 0..1. Throws
 * `InvalidOutput` (with the billed tokens) when the second parse fails.
 * With `lookups`, the model may call them first; the tokens are every step's.
 */
export async function generateStructured<S extends z.ZodType>(
  args: {
    model: Model;
    system: string;
    schema: S;
    abortSignal: AbortSignal;
    telemetry: TelemetryOptions;
    lookups?: Lookups;
  } & StructuredInput,
): Promise<{ value: z.infer<S>; tokens: Tokens }> {
  const { schema, lookups, ...request } = args;
  const result = await generateText({
    ...request,
    output: Output.object({ schema }),
    maxRetries: MAX_RETRIES,
    ...(lookups
      ? {
          tools: lookups.tools,
          stopWhen: stepCountIs(lookups.maxSteps),
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber >= lookups.maxSteps - 1 ? { toolChoice: 'none' as const } : undefined,
        }
      : {}),
  });
  const tokens = lookups ? result.totalUsage : result.usage;
  const parsed = schema.safeParse(result.output);
  if (!parsed.success) throw new InvalidOutput(tokens);
  return { value: parsed.data as z.infer<S>, tokens };
}
