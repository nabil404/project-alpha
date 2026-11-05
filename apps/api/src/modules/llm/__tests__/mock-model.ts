import type { Telemetry } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * A mock model that answers `text`, throws, or hangs until aborted. The usage
 * is the V4 nested shape; agents read it normalised as 12 in, 5 out.
 */
export function mockModel(modelId: string, answer: string | Error | 'hang') {
  return new MockLanguageModelV4({
    modelId,
    // As OpenAI's: an https image is sent as its link, never downloaded by the SDK.
    supportedUrls: { 'image/*': [/^https:\/\//] },
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

/** A telemetry integration that records the functionId of every call it sees. */
export function telemetryRecorder(): Telemetry & { seen: (string | undefined)[] } {
  const seen: (string | undefined)[] = [];
  return { seen, onStart: (event) => void seen.push(event.functionId) };
}

/** The system prompt and the user turn's text a mock model was sent on its `n`th call. */
export function sentTo(model: ReturnType<typeof mockModel>, n = 0) {
  const prompt = model.doGenerateCalls[n]!.prompt;
  const system = prompt.find((message) => message.role === 'system')?.content;
  const user = prompt
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content as { type: string; text?: string; data?: unknown }[]);
  return {
    system,
    text: user.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    files: user.filter((part) => part.type === 'file'),
  };
}
