import { createOpenAI } from '@ai-sdk/openai';
import { envSchema } from '../../../config/env.schema';
import { AiSdkLlmClient } from '../../../llm/ai-sdk-llm.client';
import { promptPackFor } from '../../../llm/prompts/prompt-pack';
import { matchProduct } from '../catalog-match';
import { EVAL_CATALOG, PRODUCT_CASES } from './fixtures/match-eval';
import { keyOf } from './fixtures/match-score';

/**
 * The end-to-end figure: the live extraction model reads each eval message and
 * the matcher resolves what it returned. Costs real tokens, so it runs only on
 * a maintainer's request: `LLM_EVAL=1` with `LLM_API_KEY` set
 * (`LLM_EVAL=1 pnpm --filter api test catalog-match.live-eval`).
 */
const live = process.env.LLM_EVAL === '1' && Boolean(process.env.LLM_API_KEY);

(live ? describe : describe.skip)('catalog matching with the live extraction model', () => {
  it('identifies the product from the raw message', async () => {
    const env = envSchema.parse(process.env);
    const openai = createOpenAI({ apiKey: env.LLM_API_KEY });
    const llm = new AiSdkLlmClient({
      routing: openai(env.LLM_MODEL_ROUTING),
      extraction: openai(env.LLM_MODEL_EXTRACTION),
      timeoutMs: env.LLM_TIMEOUT_MS,
    });

    const misses: string[] = [];
    for (const entry of PRODUCT_CASES) {
      const extracted = await llm.extractOrder(
        [{ from: 'customer', text: entry.message }],
        { items: [] },
        promptPackFor('BD'),
      );
      const item = extracted.ok ? extracted.value.items?.[0] : undefined;
      const match = matchProduct(
        [item?.productQuery ?? undefined, item?.productQueryAlt ?? undefined],
        EVAL_CATALOG,
      );
      const got =
        match.kind === 'one'
          ? keyOf(match.productId)
          : match.kind === 'some'
            ? { some: match.productIds.map(keyOf).sort() }
            : 'none';
      const want =
        typeof entry.expected === 'string'
          ? entry.expected
          : { some: [...entry.expected.some].sort() };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        misses.push(`${entry.message}: ${JSON.stringify(item ?? null)} -> ${JSON.stringify(got)}`);
      }
    }
    const rate = (PRODUCT_CASES.length - misses.length) / PRODUCT_CASES.length;
    console.warn(`live: ${(rate * 100).toFixed(1)}%\n  ${misses.join('\n  ')}`);
    expect(rate).toBeGreaterThanOrEqual(0.9);
  }, 600_000);
});
