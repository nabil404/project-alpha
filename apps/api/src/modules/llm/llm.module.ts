import { Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import type { Telemetry } from 'ai';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { Client } from 'langsmith';
import { LangSmithTelemetry } from 'langsmith/experimental/vercel';
import { AppConfig } from '../config/app.config';
import { AiSdkIntentAgent, INTENT_AGENT, type IntentAgent } from './agents/intent/intent.agent';
import { JevIntentAgent } from './agents/intent/jev-intent.agent';
import {
  AiSdkOrderExtractionAgent,
  ORDER_EXTRACTION_AGENT,
} from './agents/order-extraction/order-extraction.agent';
import { AiSdkPhotoMatchAgent, PHOTO_MATCH_AGENT } from './agents/photo-match/photo-match.agent';
import { AiSdkPostImportAgent, POST_IMPORT_AGENT } from './agents/post-import/post-import.agent';
import {
  AiSdkReplyPhrasingAgent,
  REPLY_PHRASING_AGENT,
} from './agents/reply-phrasing/reply-phrasing.agent';
import { AiSdkShopAnswerAgent, SHOP_ANSWER_AGENT } from './agents/shop-answer/shop-answer.agent';
import type { Model } from './runtime/structured';

/** The LangSmith client, or null without LANGSMITH_API_KEY: then no call is traced. */
const LANGSMITH = Symbol('LANGSMITH');

/** What every agent is built from, or null without LLM_API_KEY: then every agent is null. */
const LLM_MODELS = Symbol('LLM_MODELS');

interface LlmModels {
  /** Small, fast model: intent and phrasing, every turn. */
  routing: Model;
  /** Larger model: extraction, and the calls that read images. */
  extraction: Model;
  timeoutMs: number;
  telemetry?: Telemetry;
}

/** An agent built from the models, or null when there are none. */
function agent<T>(token: symbol, build: (models: LlmModels, config: AppConfig) => T): Provider {
  return {
    provide: token,
    inject: [LLM_MODELS, AppConfig],
    useFactory: (models: LlmModels | null, config: AppConfig): T | null =>
      models ? build(models, config) : null,
  };
}

/**
 * One provider per agent, each null without LLM_API_KEY: then the ingest
 * queues no turns, the same way an unconfigured Graph connects no Page.
 */
@Module({
  providers: [
    {
      provide: LANGSMITH,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Client | null => {
        const apiKey = config.get('LANGSMITH_API_KEY');
        if (!apiKey) return null;
        return new Client({ apiKey, apiUrl: config.get('LANGSMITH_ENDPOINT') });
      },
    },
    {
      provide: LLM_MODELS,
      inject: [AppConfig, LANGSMITH],
      useFactory: (config: AppConfig, langsmith: Client | null): LlmModels | null => {
        const apiKey = config.get('LLM_API_KEY');
        if (!apiKey) return null;
        const openai = createOpenAI({ apiKey });
        return {
          routing: openai(config.get('LLM_MODEL_ROUTING')),
          extraction: openai(config.get('LLM_MODEL_EXTRACTION')),
          timeoutMs: config.get('LLM_TIMEOUT_MS'),
          telemetry: langsmith
            ? LangSmithTelemetry({
                client: langsmith,
                projectName: config.get('LANGSMITH_PROJECT'),
                runType: 'llm',
                tracingEnabled: true,
              })
            : undefined,
        };
      },
    },
    agent(INTENT_AGENT, ({ routing, timeoutMs, telemetry }, config): IntentAgent => {
      if (config.get('LLM_INTENT_PROVIDER') !== 'jev') {
        return new AiSdkIntentAgent({ model: routing, timeoutMs, telemetry });
      }
      return new JevIntentAgent({
        // The SDK logs request bodies, customer chats included, below `warn`.
        client: new TypeSafeClient({ apiKey: config.get('TYPESAFE_API_KEY'), logLevel: 'warn' }),
        model: config.get('TYPESAFE_MODEL'),
        timeoutMs,
      });
    }),
    agent(
      ORDER_EXTRACTION_AGENT,
      ({ extraction, timeoutMs, telemetry }) =>
        new AiSdkOrderExtractionAgent({ model: extraction, timeoutMs, telemetry }),
    ),
    agent(
      REPLY_PHRASING_AGENT,
      ({ routing, timeoutMs, telemetry }) =>
        new AiSdkReplyPhrasingAgent({ model: routing, timeoutMs, telemetry }),
    ),
    agent(
      SHOP_ANSWER_AGENT,
      ({ routing, timeoutMs, telemetry }) =>
        new AiSdkShopAnswerAgent({ model: routing, timeoutMs, telemetry }),
    ),
    agent(
      PHOTO_MATCH_AGENT,
      ({ extraction, timeoutMs, telemetry }) =>
        new AiSdkPhotoMatchAgent({ model: extraction, timeoutMs, telemetry }),
    ),
    agent(
      POST_IMPORT_AGENT,
      ({ extraction, timeoutMs, telemetry }) =>
        new AiSdkPostImportAgent({ model: extraction, timeoutMs, telemetry }),
    ),
  ],
  exports: [
    INTENT_AGENT,
    ORDER_EXTRACTION_AGENT,
    REPLY_PHRASING_AGENT,
    PHOTO_MATCH_AGENT,
    POST_IMPORT_AGENT,
    SHOP_ANSWER_AGENT,
  ],
})
export class LlmModule implements OnApplicationShutdown {
  constructor(@Inject(LANGSMITH) private readonly langsmith: Client | null) {}

  /** Traces are sent in background batches; a deploy would otherwise drop the last ones. */
  async onApplicationShutdown(): Promise<void> {
    await this.langsmith?.awaitPendingTraceBatches();
  }
}
