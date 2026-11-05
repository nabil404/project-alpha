import { Logger } from '@nestjs/common';
import {
  MAX_ANSWER_FACTS,
  shopAnswerSchema,
  type AssistantTone,
  type ShopAnswer,
} from '@app/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { ChatLine, LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { numberedFact, shopAnswerPrompt, shopAnswerSystem } from './shop-answer.prompt';

/** One thing the shop has written down, chosen by code; the model sees it numbered from 1. */
export interface ShopFact {
  /** What the fact is about, in English: "Delivery", "Product", "Seller's notes". */
  about: string;
  text: string;
}

/**
 * Lookups code runs for the model when the given facts miss what the
 * customer asks about. Each takes the model's words and returns facts code
 * wrote from the catalog; none touches the database or returns an id.
 */
export interface ShopFactLookup {
  /** The products the words name, as code matches them. */
  findProduct(words: string): ShopFact[];
  /** The in-stock listing of each category the name is close to. */
  listCategory(name: string): ShopFact[];
}

/** Model steps an answer may take: up to two rounds of lookups, then the answer. */
export const ANSWER_MAX_STEPS = 3;

/** Facts one lookup may add; past it, the rest are left out. */
export const MAX_FACTS_PER_LOOKUP = 5;

/** Longest words a lookup takes from the model. */
export const MAX_LOOKUP_WORDS = 100;

/** A customer's question, the facts that may answer it, and how to say it. */
export interface ShopAnswerInput {
  facts: ShopFact[];
  /** Absent, the model answers from `facts` alone. */
  lookup?: ShopFactLookup;
  /** The last few chat lines; the question is the customer's latest. */
  history: ChatLine[];
  /** ISO 639-1: the reply language, or only the fallback when `matchCustomer`. */
  language: string;
  matchCustomer: boolean;
  tone: AssistantTone;
  pack: PromptPack;
}

/**
 * The answer, and every fact it could cite, numbered from 1: the given facts,
 * then those its lookups added. The caller checks citations and numbers
 * against these, never against `input.facts` alone.
 */
export interface ShopAnswered {
  answer: ShopAnswer;
  facts: ShopFact[];
}

/**
 * Answers a customer's question from the facts code gave it, looking up more
 * through code when they miss, or says the facts do not answer it. Its text
 * is only ever sent after `checkReply`.
 */
export type ShopAnswerAgent = Agent<ShopAnswerInput, ShopAnswered>;

/** The `ShopAnswerAgent | null` provider: null without LLM_API_KEY. */
export const SHOP_ANSWER_AGENT = Symbol('SHOP_ANSWER_AGENT');

/** Answers through the routing model: the facts are given, so no larger model is needed. */
export class AiSdkShopAnswerAgent implements ShopAnswerAgent {
  readonly purpose = 'answer' as const;
  private readonly logger = new Logger('ShopAnswerAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run(input: ShopAnswerInput): Promise<LlmResult<ShopAnswered>> {
    const { model, timeoutMs, telemetry } = this.options;
    const facts = [...input.facts];
    return runLlmCall(
      {
        purpose: this.purpose,
        modelId: model.modelId,
        pack: input.pack,
        timeoutMs,
        logger: this.logger,
      },
      async (abortSignal) => {
        const { value, tokens } = await generateStructured({
          model,
          system: shopAnswerSystem(input.pack, Boolean(input.lookup)),
          prompt: shopAnswerPrompt(input),
          schema: shopAnswerSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
          ...(input.lookup
            ? { lookups: { tools: lookupTools(input.lookup, facts), maxSteps: ANSWER_MAX_STEPS } }
            : {}),
        });
        return { value: { answer: value, facts }, tokens };
      },
    );
  }
}

const lookupInput = z.object({ words: z.string().trim().min(1).max(MAX_LOOKUP_WORDS) });

/**
 * The lookups as AI SDK tools. Each found fact joins `facts` once, numbered
 * after the rest; one already there keeps its number. The tool answers with
 * the numbered lines, as data, so the model cites them like the given ones.
 */
function lookupTools(lookup: ShopFactLookup, facts: ShopFact[]) {
  const add = (found: ShopFact[]): string => {
    const lines: string[] = [];
    for (const fact of found.slice(0, MAX_FACTS_PER_LOOKUP)) {
      let index = facts.findIndex((had) => had.about === fact.about && had.text === fact.text);
      if (index === -1) {
        if (facts.length >= MAX_ANSWER_FACTS) break;
        index = facts.push(fact) - 1;
      }
      lines.push(numberedFact(fact, index));
    }
    return lines.length > 0 ? lines.join('\n') : 'No facts found.';
  };
  return {
    findProduct: tool({
      description:
        "Look up the shop's products by the name the customer used. Returns numbered facts.",
      inputSchema: lookupInput,
      execute: ({ words }) => add(lookup.findProduct(words)),
    }),
    listCategory: tool({
      description:
        'List what is in stock in a category the customer asked about. Returns numbered facts.',
      inputSchema: lookupInput,
      execute: ({ words }) => add(lookup.listCategory(words)),
    }),
  };
}
