import type {
  AssistantTone,
  ExtractedOrder,
  IntentResult,
  PhotoMatch,
  PostProducts,
} from '@app/shared';
import type { PromptPack } from './prompts/prompt-pack';

/** What each call was for; one row per call in llm_call. */
export const LLM_PURPOSES = [
  'classify',
  'extract',
  'phrase',
  'vision_match',
  'post_import',
] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export const LLM_OUTCOMES = ['ok', 'timeout', 'provider_error', 'invalid_output'] as const;
export type LlmOutcome = (typeof LLM_OUTCOMES)[number];
export type LlmFailure = Exclude<LlmOutcome, 'ok'>;

/** Tokens are null when the provider never answered. */
export interface LlmUsage {
  purpose: LlmPurpose;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  /** The region's prompt (`PromptPack.id`); null for a call whose prompt has no region. */
  promptPack: string | null;
}

export type LlmCallRecord = LlmUsage & { outcome: LlmOutcome };

/** The `LlmClient | null` provider: null when LLM_API_KEY is unset. */
export const LLM = Symbol('LLM');

/** Every call answers; none throws. */
export type LlmResult<T> =
  { ok: true; value: T; usage: LlmUsage } | { ok: false; reason: LlmFailure; usage: LlmUsage };

export interface ChatLine {
  from: 'customer' | 'shop' | 'assistant';
  text: string;
}

/** What to say, decided by code, and the only facts the reply may use. */
export interface PhraseRequest {
  instruction: string;
  facts: Record<string, unknown>;
  /** ISO 639-1: the reply language, or only the fallback when `matchCustomer`. */
  language: string;
  /** The seller chose "Match the customer": mirror the customer's language and script. */
  matchCustomer: boolean;
  /** The seller's choice in Settings > Order assistant. */
  tone: AssistantTone;
  /** The shop's region: the languages the customer may write in. */
  pack: PromptPack;
}

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

export interface LlmClient {
  classifyIntent(history: ChatLine[], pack: PromptPack): Promise<LlmResult<IntentResult>>;
  extractOrder(
    history: ChatLine[],
    context: ExtractionContext,
    pack: PromptPack,
  ): Promise<LlmResult<ExtractedOrder>>;
  phraseReply(request: PhraseRequest, history: ChatLine[]): Promise<LlmResult<string>>;
  matchProductPhoto(request: PhotoMatchRequest): Promise<LlmResult<PhotoMatch>>;
  extractProductsFromPost(request: PostExtractionRequest): Promise<LlmResult<PostProducts>>;
}
