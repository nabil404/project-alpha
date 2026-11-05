import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { intentResultSchema } from '@app/shared';
import { registerTelemetry } from 'ai';
import { mockModel, telemetryRecorder } from '../../__tests__/mock-model';
import { promptPackFor } from '../../prompts/prompt-pack';
import { runLlmCall } from '../run-llm-call';
import { generateStructured, telemetryFor } from '../structured';

const pack = promptPackFor('BD');
const logger = new Logger('RunLlmCallSpec');

/** One structured call, as the agents make it, against a model answering `answer`. */
function call(answer: string | Error | 'hang', timeoutMs = 2_000) {
  const model = mockModel('mock-model', answer);
  return runLlmCall(
    { purpose: 'classify', modelId: model.modelId, pack, timeoutMs, logger },
    (abortSignal) =>
      generateStructured({
        model,
        system: 'system',
        prompt: 'prompt',
        schema: intentResultSchema,
        abortSignal,
        telemetry: telemetryFor(undefined, 'classify'),
      }),
  );
}

beforeAll(() => Logger.overrideLogger(false));

describe('runLlmCall', () => {
  it('returns the value with its usage', async () => {
    await expect(call('{"intent":"order","confidence":0.9}')).resolves.toEqual({
      ok: true,
      value: { intent: 'order', confidence: 0.9 },
      usage: {
        purpose: 'classify',
        model: 'mock-model',
        inputTokens: 12,
        outputTokens: 5,
        latencyMs: expect.any(Number),
        promptPack: 'bn-BD',
      },
    });
  });

  it('reports invalid JSON as invalid_output', async () => {
    await expect(call('not json at all')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_output',
      usage: { purpose: 'classify' },
    });
  });

  it('reports output that fails the Zod schema as invalid_output, keeping the billed tokens', async () => {
    await expect(call('{"intent":"order","confidence":1.7}')).resolves.toMatchObject({
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
      await call(error);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain('AI_APICallError');
      expect(line).toContain('401');
      expect(line).not.toContain('secret upstream body');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a provider error as provider_error, with no tokens', async () => {
    await expect(call(new Error('upstream exploded'))).resolves.toMatchObject({
      ok: false,
      reason: 'provider_error',
      usage: { inputTokens: null, outputTokens: null },
    });
  });

  it('gives up after the timeout', async () => {
    await expect(call('hang', 20)).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  // Last: registerTelemetry is global and cannot be undone.
  it('traces nothing without telemetry, even when an integration is registered globally', async () => {
    const global = telemetryRecorder();
    registerTelemetry(global);
    await call('{"intent":"order","confidence":0.9}');
    expect(global.seen).toHaveLength(0);
  });
});
