import { Module } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import { AppConfig } from '../config/app.config';
import { AiSdkLlmClient } from './ai-sdk-llm.client';
import { LLM, type LlmClient } from './llm.types';

/**
 * The assistant's LLM, or null without LLM_API_KEY: then the ingest queues no
 * turns, the same way an unconfigured Graph connects no Page.
 */
@Module({
  providers: [
    {
      provide: LLM,
      inject: [AppConfig],
      useFactory: (config: AppConfig): LlmClient | null => {
        const apiKey = config.get('LLM_API_KEY');
        if (!apiKey) return null;
        const openai = createOpenAI({ apiKey });
        return new AiSdkLlmClient({
          routing: openai(config.get('LLM_MODEL_ROUTING')),
          extraction: openai(config.get('LLM_MODEL_EXTRACTION')),
          timeoutMs: config.get('LLM_TIMEOUT_MS'),
        });
      },
    },
  ],
  exports: [LLM],
})
export class LlmModule {}
