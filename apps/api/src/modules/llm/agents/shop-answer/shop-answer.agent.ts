import { Logger } from '@nestjs/common';
import { shopAnswerSchema, type AssistantTone, type ShopAnswer } from '@app/shared';
import type { ChatLine, LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { shopAnswerPrompt, shopAnswerSystem } from './shop-answer.prompt';

/** One thing the shop has written down, chosen by code; the model sees it numbered from 1. */
export interface ShopFact {
  /** What the fact is about, in English: "Delivery", "Product", "Seller's notes". */
  about: string;
  text: string;
}

/** A customer's question, the facts that may answer it, and how to say it. */
export interface ShopAnswerInput {
  facts: ShopFact[];
  /** The last few chat lines; the question is the customer's latest. */
  history: ChatLine[];
  /** ISO 639-1: the reply language, or only the fallback when `matchCustomer`. */
  language: string;
  matchCustomer: boolean;
  tone: AssistantTone;
  pack: PromptPack;
}

/**
 * Answers a customer's question from the facts code gave it, or says the
 * facts do not answer it. Its text is only ever sent after `checkReply`.
 */
export type ShopAnswerAgent = Agent<ShopAnswerInput, ShopAnswer>;

/** The `ShopAnswerAgent | null` provider: null without LLM_API_KEY. */
export const SHOP_ANSWER_AGENT = Symbol('SHOP_ANSWER_AGENT');

/** Answers through the routing model: the facts are given, so no larger model is needed. */
export class AiSdkShopAnswerAgent implements ShopAnswerAgent {
  readonly purpose = 'answer' as const;
  private readonly logger = new Logger('ShopAnswerAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run(input: ShopAnswerInput): Promise<LlmResult<ShopAnswer>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      {
        purpose: this.purpose,
        modelId: model.modelId,
        pack: input.pack,
        timeoutMs,
        logger: this.logger,
      },
      (abortSignal) =>
        generateStructured({
          model,
          system: shopAnswerSystem(input.pack),
          prompt: shopAnswerPrompt(input),
          schema: shopAnswerSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
        }),
    );
  }
}
