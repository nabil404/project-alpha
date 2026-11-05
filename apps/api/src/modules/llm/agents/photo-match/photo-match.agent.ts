import { Logger } from '@nestjs/common';
import { photoMatchSchema, type PhotoMatch } from '@app/shared';
import type { LlmResult } from '../../llm.types';
import { runLlmCall } from '../../runtime/run-llm-call';
import { generateStructured, telemetryFor, type AiSdkAgentOptions } from '../../runtime/structured';
import type { Agent } from '../agent';
import { MATCH_PRODUCT_PHOTO_SYSTEM, matchProductPhotoContent } from './photo-match.prompt';

/**
 * A customer's photos and the products they may show. Every url is our own
 * bucket's; each candidate is shown with its number, which is all a match may
 * name.
 */
export interface PhotoMatchRequest {
  photos: string[];
  candidates: { number: number; name: string; imageUrl: string }[];
  /** What the customer typed beside the photo, if anything. */
  words?: string;
}

/** Says which numbered candidates a customer's photo shows; it never sees the chat. */
export type PhotoMatchAgent = Agent<PhotoMatchRequest, PhotoMatch>;

/** The `PhotoMatchAgent | null` provider: null without LLM_API_KEY. */
export const PHOTO_MATCH_AGENT = Symbol('PHOTO_MATCH_AGENT');

/** The larger model: it reads images, and a wrong match costs more than the call. */
export class AiSdkPhotoMatchAgent implements PhotoMatchAgent {
  readonly purpose = 'vision_match' as const;
  private readonly logger = new Logger('PhotoMatchAgent');

  constructor(private readonly options: AiSdkAgentOptions) {}

  run(request: PhotoMatchRequest): Promise<LlmResult<PhotoMatch>> {
    const { model, timeoutMs, telemetry } = this.options;
    return runLlmCall(
      { purpose: this.purpose, modelId: model.modelId, pack: null, timeoutMs, logger: this.logger },
      (abortSignal) =>
        generateStructured({
          model,
          system: MATCH_PRODUCT_PHOTO_SYSTEM,
          messages: [{ role: 'user', content: matchProductPhotoContent(request) }],
          schema: photoMatchSchema,
          abortSignal,
          telemetry: telemetryFor(telemetry, this.purpose),
        }),
    );
  }
}
