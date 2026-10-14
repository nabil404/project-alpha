import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { registerTelemetry, type Telemetry } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { AiSdkLlmClient } from '../ai-sdk-llm.client';
import type { ChatLine } from '../llm.types';

const history: ChatLine[] = [{ from: 'customer', text: 'I want the red saree, 2 pcs' }];

/**
 * A mock model that answers `text`, throws, or hangs until aborted. The usage
 * is the V4 nested shape; the assertions below read the normalised 12 in, 5 out.
 */
function model(modelId: string, answer: string | Error | 'hang') {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async ({ abortSignal }) => {
      if (answer === 'hang') {
        return new Promise((_, reject) =>
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason)),
        );
      }
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: 'text', text: answer }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

const client = (
  routing: string | Error | 'hang',
  extraction: string | Error | 'hang' = '{}',
  timeoutMs = 2_000,
  telemetry?: Telemetry,
) =>
  new AiSdkLlmClient({
    routing: model('mock-routing', routing),
    extraction: model('mock-extraction', extraction),
    timeoutMs,
    telemetry,
  });

/** A telemetry integration that records the functionId of every call it sees. */
function recorder(): Telemetry & { seen: (string | undefined)[] } {
  const seen: (string | undefined)[] = [];
  return { seen, onStart: (event) => void seen.push(event.functionId) };
}

const RED_SAREE = {
  ref: null,
  productQuery: 'red saree',
  productQueryAlt: 'রেড শাড়ি',
  variantQuery: null,
  variantQueryAlt: null,
  quantity: 2,
};
const ORDER = JSON.stringify({
  items: [RED_SAREE],
  customerName: null,
  phone: null,
  deliveryAddress: null,
  deliveryArea: null,
  confidence: 0.92,
});

const INTENT = '{"intent":"order","confidence":0.9}';

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkLlmClient', () => {
  it('classifies with the routing model and reports usage', async () => {
    const result = await client('{"intent":"order","confidence":0.9}').classifyIntent(history);
    expect(result).toEqual({
      ok: true,
      value: { intent: 'order', confidence: 0.9 },
      usage: expect.objectContaining({
        purpose: 'classify',
        model: 'mock-routing',
        inputTokens: 12,
        outputTokens: 5,
      }),
    });
  });

  it('extracts with the extraction model', async () => {
    const result = await client('unused', ORDER).extractOrder(history, { items: [] });
    expect(result).toMatchObject({
      ok: true,
      value: { items: [RED_SAREE] },
      usage: { purpose: 'extract', model: 'mock-extraction' },
    });
  });

  it('phrases with the routing model and trims the text', async () => {
    const result = await client('  Which colour would you like?  ').phraseReply(
      { instruction: 'Ask which colour.', facts: { productName: 'Red saree' }, language: 'en' },
      history,
    );
    expect(result).toMatchObject({
      ok: true,
      value: 'Which colour would you like?',
      usage: { purpose: 'phrase' },
    });
  });

  it('reports invalid JSON as invalid_output', async () => {
    const result = await client('not json at all').classifyIntent(history);
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid_output',
      usage: { purpose: 'classify' },
    });
  });

  it('reports output that fails the Zod schema as invalid_output', async () => {
    const result = await client('{"intent":"order","confidence":1.7}').classifyIntent(history);
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid_output',
      usage: { inputTokens: 12, outputTokens: 5 },
    });
  });

  it('logs the error name and HTTP status of a failure, never its message', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const error = Object.assign(new Error('secret upstream body'), {
        name: 'AI_APICallError',
        statusCode: 401,
      });
      await client(error).classifyIntent(history);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain('AI_APICallError');
      expect(line).toContain('401');
      expect(line).not.toContain('secret upstream body');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a provider error as provider_error, with no tokens', async () => {
    const result = await client(new Error('upstream exploded')).classifyIntent(history);
    expect(result).toMatchObject({
      ok: false,
      reason: 'provider_error',
      usage: { inputTokens: null, outputTokens: null },
    });
  });

  it('gives up after the timeout', async () => {
    const result = await client('hang', '{}', 20).classifyIntent(history);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('traces each call under its purpose when given telemetry', async () => {
    const telemetry = recorder();
    const traced = client(INTENT, ORDER, 2_000, telemetry);
    await traced.classifyIntent(history);
    await traced.extractOrder(history, { items: [] });
    await traced.phraseReply({ instruction: 'greet', facts: {}, language: 'en' }, history);
    expect(telemetry.seen).toEqual(['classify', 'extract', 'phrase']);
  });

  // Last: registerTelemetry is global and cannot be undone.
  it('traces nothing without telemetry, even when an integration is registered globally', async () => {
    const global = recorder();
    registerTelemetry(global);
    await client(INTENT).classifyIntent(history);
    expect(global.seen).toHaveLength(0);
  });
});
