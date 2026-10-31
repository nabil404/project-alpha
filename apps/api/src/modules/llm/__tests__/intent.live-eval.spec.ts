import { createOpenAI } from '@ai-sdk/openai';
import type { IntentResult } from '@app/shared';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { envSchema } from '../../config/env.schema';
import { CONFIDENCE_FLOOR } from '../../conversations/assistant/conversation-machine';
import { AiSdkLlmClient } from '../ai-sdk-llm.client';
import { JevIntentClassifier } from '../jev-intent.classifier';
import type { LlmClient } from '../llm.types';
import { promptPackFor } from '../prompts/prompt-pack';
import { INTENT_CASES } from './fixtures/intent-eval';

/**
 * Intent on the same hand-labelled chats from each provider that has a key:
 * the routing model with `LLM_API_KEY`, Jev with `TYPESAFE_API_KEY`. Costs
 * real tokens, so it runs only on a maintainer's request
 * (`LLM_EVAL=1 pnpm --filter api test intent.live-eval`).
 *
 * Besides accuracy it counts what the state machine would do: a wrong intent
 * at or above the confidence floor is acted on, while one below it only hands
 * the chat to the seller.
 */
const live = process.env.LLM_EVAL === '1';
const env = live ? envSchema.parse(process.env) : undefined;

const providers: [string, Pick<LlmClient, 'classifyIntent'>][] = [];
if (env?.LLM_API_KEY) {
  const openai = createOpenAI({ apiKey: env.LLM_API_KEY });
  const llm = new AiSdkLlmClient({
    routing: openai(env.LLM_MODEL_ROUTING),
    extraction: openai(env.LLM_MODEL_EXTRACTION),
    timeoutMs: env.LLM_TIMEOUT_MS,
  });
  providers.push([env.LLM_MODEL_ROUTING, llm]);
}
if (env?.TYPESAFE_API_KEY) {
  const jev = new JevIntentClassifier({
    client: new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, logLevel: 'warn' }),
    model: env.TYPESAFE_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
  });
  providers.push([env.TYPESAFE_MODEL, jev]);
}

/** The lowest, median and highest confidence the provider gave, failures left out. */
function confidences(results: Awaited<ReturnType<LlmClient['classifyIntent']>>[]): string {
  const sorted = results
    .flatMap((result) => (result.ok ? [result.value.confidence] : []))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 'none';
  const pick = (at: number) => sorted[Math.floor(at * (sorted.length - 1))]!.toFixed(2);
  return `min ${pick(0)}, median ${pick(0.5)}, max ${pick(1)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

(providers.length > 0 ? describe.each(providers) : describe.skip.each([['none', null]]))(
  'intent with %s',
  (name, classifier) => {
    it('classifies the eval chats', async () => {
      const pack = promptPackFor('BD');
      const results = await Promise.all(
        INTENT_CASES.map((entry) => classifier!.classifyIntent(entry.history, pack)),
      );

      let correct = 0;
      const actedWrong: string[] = [];
      const handedOff: string[] = [];
      results.forEach((result, i) => {
        const entry = INTENT_CASES[i]!;
        const text = entry.history.at(-1)!.text;
        if (!result.ok) {
          handedOff.push(`${text}: ${result.reason}`);
          return;
        }
        const got: IntentResult = result.value;
        const line = `${text}: want ${entry.expected}, got ${got.intent} @ ${got.confidence.toFixed(2)}`;
        if (got.intent === entry.expected) correct += 1;
        if (got.confidence < CONFIDENCE_FLOOR) handedOff.push(line);
        else if (got.intent !== entry.expected) actedWrong.push(line);
      });

      const rate = correct / INTENT_CASES.length;
      console.warn(
        [
          `${name}: accuracy ${(rate * 100).toFixed(1)}% of ${INTENT_CASES.length}`,
          `confidence: ${confidences(results)}`,
          `median latency: ${median(results.map((result) => result.usage.latencyMs))}ms, input tokens: ${results.reduce((sum, result) => sum + (result.usage.inputTokens ?? 0), 0)}`,
          `acted on a wrong intent: ${actedWrong.length}`,
          ...actedWrong.map((line) => `  ${line}`),
          `handed off for low confidence or failure: ${handedOff.length}`,
          ...handedOff.map((line) => `  ${line}`),
        ].join('\n'),
      );
      expect(rate).toBeGreaterThanOrEqual(0.9);
    }, 300_000);
  },
);
