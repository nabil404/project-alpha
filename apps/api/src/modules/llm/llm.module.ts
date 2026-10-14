import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import { Client } from 'langsmith';
import { LangSmithTelemetry } from 'langsmith/experimental/vercel';
import { AppConfig } from '../config/app.config';
import { AiSdkLlmClient } from './ai-sdk-llm.client';
import { LLM, type LlmClient } from './llm.types';

/** The LangSmith client, or null without LANGSMITH_API_KEY: then no call is traced. */
const LANGSMITH = Symbol('LANGSMITH');

/**
 * The assistant's LLM, or null without LLM_API_KEY: then the ingest queues no
 * turns, the same way an unconfigured Graph connects no Page.
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
      provide: LLM,
      inject: [AppConfig, LANGSMITH],
      useFactory: (config: AppConfig, langsmith: Client | null): LlmClient | null => {
        const apiKey = config.get('LLM_API_KEY');
        if (!apiKey) return null;
        const openai = createOpenAI({ apiKey });
        return new AiSdkLlmClient({
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
        });
      },
    },
  ],
  exports: [LLM],
})
export class LlmModule implements OnApplicationShutdown {
  constructor(@Inject(LANGSMITH) private readonly langsmith: Client | null) {}

  /** Traces are sent in background batches; a deploy would otherwise drop the last ones. */
  async onApplicationShutdown(): Promise<void> {
    await this.langsmith?.awaitPendingTraceBatches();
  }
}
