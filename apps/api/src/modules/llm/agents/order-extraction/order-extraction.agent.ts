import { Logger } from '@nestjs/common';
import { extractedOrderSchema, type ExtractedOrder } from '@app/shared';
import type { ChatLine, LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { extractOrderPrompt, extractOrderSystem } from './order-extraction.prompt';

/**
 * What extraction is told is already collected. Each item carries the index a
 * returned `ref` points at, and the catalog's name once code matched it (the
 * customer's words until then).
 */
export interface ExtractionContext {
  /** The customer's earlier words beside the catalog's names, to tell which item a message means; never to be returned. */
  items: {
    ref: number;
    product: string;
    customerWords?: string;
    variant?: string;
    customerVariantWords?: string;
    quantity?: number;
  }[];
  customerName?: string;
  phone?: string;
  deliveryAddress?: string;
  deliveryArea?: string;
  /** The customer's profile name the shop just asked them to confirm for the order. */
  offeredName?: string;
}

export interface OrderExtractionInput {
  history: ChatLine[];
  context: ExtractionContext;
  pack: PromptPack;
}

/** Copies out the customer's raw words for items and details, never catalog ids. */
export type OrderExtractionAgent = Agent<OrderExtractionInput, ExtractedOrder>;

/** The `OrderExtractionAgent | null` provider: null without LLM_API_KEY. */
export const ORDER_EXTRACTION_AGENT = Symbol('ORDER_EXTRACTION_AGENT');

/** Extraction through the larger model. */
export class AiSdkOrderExtractionAgent implements OrderExtractionAgent {
  readonly purpose = 'extract' as const;
  private readonly logger = new Logger('OrderExtractionAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run({ history, context, pack }: OrderExtractionInput): Promise<LlmResult<ExtractedOrder>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      { purpose: this.purpose, modelId: model.modelId, pack, timeoutMs, logger: this.logger },
      (abortSignal) =>
        generateStructured({
          model,
          system: extractOrderSystem(pack),
          prompt: extractOrderPrompt(history, context),
          schema: extractedOrderSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
        }),
    );
  }
}
