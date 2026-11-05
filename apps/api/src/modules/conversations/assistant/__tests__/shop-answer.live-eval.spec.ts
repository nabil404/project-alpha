import { createOpenAI } from '@ai-sdk/openai';
import { envSchema } from '../../../config/env.schema';
import { AiSdkShopAnswerAgent } from '../../../llm/agents/shop-answer/shop-answer.agent';
import { promptPackFor } from '../../../llm/prompts/prompt-pack';
import { checkReply } from '../reply-check';
import { allowedFrom, shopFactLookup, shopFacts } from '../shop-facts';
import { EVAL_CATALOG } from './fixtures/match-eval';

/**
 * The live routing model answering shop questions from the facts code chose,
 * and from what its lookups add when they miss.
 * An answer counts only if it passes the turn's own checks; an `unknown` case
 * must come back unknown, never with an invented answer. Costs real tokens, so
 * it runs only on request: `LLM_EVAL=1` with `LLM_API_KEY` set
 * (`LLM_EVAL=1 pnpm --filter api test shop-answer.live-eval`).
 */
const live = process.env.LLM_EVAL === '1' && Boolean(process.env.LLM_API_KEY);

const SHOP = {
  delivery: [
    { id: 'd1', areaName: 'Dhaka', charge: 6_000, deliveryTime: '1-2 days' },
    { id: 'd9', areaName: null, charge: 12_000, deliveryTime: '3-5 days' },
  ],
  freeDeliveryOver: 300_000,
  currency: 'BDT',
  pickupAddress: 'Shop 4, New Market, Dhaka',
  contactPhone: '+8801812000000',
  notes: 'Cash on delivery only. Exchange within 3 days if unused.',
  catalog: EVAL_CATALOG,
  orderProductIds: [],
  language: 'en' as const,
};

/** `before` is the customer's earlier line: a product named there is only in the facts once looked up. */
const CASES: { before?: string; question: string; expect: 'answered' | 'unknown' }[] = [
  { question: 'Dhaka te delivery charge koto?', expect: 'answered' },
  { question: 'ঢাকার বাইরে ডেলিভারি কত দিনে?', expect: 'answered' },
  { question: 'How do I pay?', expect: 'answered' },
  { question: 'Can I exchange if it does not fit?', expect: 'answered' },
  { question: 'jamdani saree er dam koto?', expect: 'answered' },
  { question: 'Is the panjabi available?', expect: 'answered' },
  { question: 'Where is your shop?', expect: 'answered' },
  { question: 'Any discount if I buy 3?', expect: 'unknown' },
  { question: 'Can you deliver to Dhaka by tomorrow morning?', expect: 'unknown' },
  { question: 'Do you accept bKash?', expect: 'unknown' },
  { question: 'Is the jamdani pure silk?', expect: 'unknown' },
  { before: 'jamdani saree ta dekhchilam', question: 'dam koto?', expect: 'answered' },
  { before: 'I saw your panjabi', question: 'how much is it?', expect: 'answered' },
];

(live ? describe : describe.skip)('shop answers with the live routing model', () => {
  it('answers from the facts, and says unknown rather than invent', async () => {
    const env = envSchema.parse(process.env);
    const agent = new AiSdkShopAnswerAgent({
      model: createOpenAI({ apiKey: env.LLM_API_KEY })(env.LLM_MODEL_ROUTING),
      timeoutMs: env.LLM_TIMEOUT_MS,
    });

    const misses: string[] = [];
    let invented = 0;
    for (const entry of CASES) {
      const { facts } = shopFacts({ ...SHOP, words: entry.question });
      const result = await agent.run({
        facts,
        lookup: shopFactLookup(SHOP),
        history: [
          ...(entry.before
            ? [
                { from: 'customer' as const, text: entry.before },
                { from: 'assistant' as const, text: 'Ji, bolun!' },
              ]
            : []),
          { from: 'customer', text: entry.question },
        ],
        language: 'bn',
        matchCustomer: true,
        tone: 'friendly',
        pack: promptPackFor('BD'),
      });
      const value = result.ok ? result.value.answer : null;
      const seen = result.ok ? result.value.facts : facts;
      const passes =
        value?.kind === 'answered' &&
        value.text !== null &&
        value.facts.length > 0 &&
        value.facts.every((n) => n <= seen.length) &&
        checkReply(value.text, allowedFrom(seen, SHOP.contactPhone)).ok;
      const got = passes ? 'answered' : 'unknown';
      if (entry.expect === 'unknown' && got === 'answered') invented += 1;
      if (got !== entry.expect) misses.push(`${entry.question}: ${JSON.stringify(value)}`);
    }
    const rate = (CASES.length - misses.length) / CASES.length;
    console.warn(`live: ${(rate * 100).toFixed(1)}%\n  ${misses.join('\n  ')}`);
    expect(invented).toBe(0);
    expect(rate).toBeGreaterThanOrEqual(0.8);
  }, 600_000);
});
