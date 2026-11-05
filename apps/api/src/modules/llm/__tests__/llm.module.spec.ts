import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfig } from '../../config/app.config';
import { AiSdkIntentAgent, INTENT_AGENT } from '../agents/intent/intent.agent';
import { JevIntentAgent } from '../agents/intent/jev-intent.agent';
import {
  AiSdkOrderExtractionAgent,
  ORDER_EXTRACTION_AGENT,
} from '../agents/order-extraction/order-extraction.agent';
import { AiSdkPhotoMatchAgent, PHOTO_MATCH_AGENT } from '../agents/photo-match/photo-match.agent';
import { AiSdkPostImportAgent, POST_IMPORT_AGENT } from '../agents/post-import/post-import.agent';
import {
  AiSdkReplyPhrasingAgent,
  REPLY_PHRASING_AGENT,
} from '../agents/reply-phrasing/reply-phrasing.agent';
import { LlmModule } from '../llm.module';

const TOKENS = [
  INTENT_AGENT,
  ORDER_EXTRACTION_AGENT,
  REPLY_PHRASING_AGENT,
  PHOTO_MATCH_AGENT,
  POST_IMPORT_AGENT,
];

const DEFAULTS: Record<string, unknown> = {
  LLM_MODEL_ROUTING: 'routing-model',
  LLM_MODEL_EXTRACTION: 'extraction-model',
  LLM_TIMEOUT_MS: 15_000,
  LLM_INTENT_PROVIDER: 'openai',
  TYPESAFE_MODEL: 'jev-1.14.0',
};

/** LlmModule against a config holding `env` over the defaults; reads each agent token. */
async function agents(env: Record<string, unknown>) {
  const config = { get: (key: string) => ({ ...DEFAULTS, ...env })[key] };
  @Global()
  @Module({ providers: [{ provide: AppConfig, useValue: config }], exports: [AppConfig] })
  class ConfigStub {}
  const moduleRef = await Test.createTestingModule({ imports: [ConfigStub, LlmModule] }).compile();
  return TOKENS.map((token) => moduleRef.get<unknown>(token));
}

/** The model id an AI SDK agent was built with. */
const modelOf = (agent: unknown) =>
  (agent as { options: { model: { modelId: string } } }).options.model.modelId;

describe('LlmModule', () => {
  it('provides no agent without LLM_API_KEY', async () => {
    expect(await agents({ LLM_INTENT_PROVIDER: 'jev', TYPESAFE_API_KEY: 'k' })).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('builds each agent on its model tier', async () => {
    const [intent, extraction, phrasing, photo, post] = await agents({ LLM_API_KEY: 'k' });
    expect(intent).toBeInstanceOf(AiSdkIntentAgent);
    expect(extraction).toBeInstanceOf(AiSdkOrderExtractionAgent);
    expect(phrasing).toBeInstanceOf(AiSdkReplyPhrasingAgent);
    expect(photo).toBeInstanceOf(AiSdkPhotoMatchAgent);
    expect(post).toBeInstanceOf(AiSdkPostImportAgent);
    expect([intent, extraction, phrasing, photo, post].map(modelOf)).toEqual([
      'routing-model',
      'extraction-model',
      'routing-model',
      'extraction-model',
      'extraction-model',
    ]);
  });

  it('classifies intent through Jev when LLM_INTENT_PROVIDER is jev', async () => {
    const [intent, extraction] = await agents({
      LLM_API_KEY: 'k',
      LLM_INTENT_PROVIDER: 'jev',
      TYPESAFE_API_KEY: 'k',
    });
    expect(intent).toBeInstanceOf(JevIntentAgent);
    expect(extraction).toBeInstanceOf(AiSdkOrderExtractionAgent);
  });
});
