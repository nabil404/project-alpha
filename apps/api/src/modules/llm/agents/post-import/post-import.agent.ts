import { Logger } from '@nestjs/common';
import { postProductsSchema, type PostProducts } from '@app/shared';
import type { LlmResult } from '../../llm.types';
import type { PromptPack } from '../../prompts/prompt-pack';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import {
  extractProductsFromPostContent,
  extractProductsFromPostSystem,
} from './post-import.prompt';

/**
 * One Facebook post to read into products. Every photo url is our own
 * bucket's copy; the caption and category names are the seller's.
 */
export interface PostExtractionRequest {
  caption: string | null;
  photos: string[];
  /** ISO 4217, for reading prices. */
  currency: string;
  /** The shop's region: the languages the caption and aliases are in. */
  pack: PromptPack;
  /** The shop's live category names; only these may come back as `existing`. */
  categories: string[];
  /** The seller said the post does hold a product (Import anyway). */
  hint?: boolean;
}

/** Reads one of the Page's posts into the products it sells, for an import. */
export type PostImportAgent = Agent<PostExtractionRequest, PostProducts>;

/** The `PostImportAgent | null` provider: null without LLM_API_KEY. */
export const POST_IMPORT_AGENT = Symbol('POST_IMPORT_AGENT');

/** The larger model: it reads the post's photos, prices written on them included. */
export class AiSdkPostImportAgent implements PostImportAgent {
  readonly purpose = 'post_import' as const;
  private readonly logger = new Logger('PostImportAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run(request: PostExtractionRequest): Promise<LlmResult<PostProducts>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      {
        purpose: this.purpose,
        modelId: model.modelId,
        pack: request.pack,
        timeoutMs,
        logger: this.logger,
      },
      (abortSignal) =>
        generateStructured({
          model,
          system: extractProductsFromPostSystem(request.pack),
          messages: [{ role: 'user', content: extractProductsFromPostContent(request) }],
          schema: postProductsSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
        }),
    );
  }
}
