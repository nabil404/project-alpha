import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { InternalServerError, type SystemOneRequest } from '@typesafe-ai/sdk';
import { JevIntentClassifier, type JevIntentOptions } from '../jev-intent.classifier';
import type { ChatLine } from '../llm.types';
import { classifyIntentState } from '../prompts/classify-intent-jev';
import { promptPackFor } from '../prompts/prompt-pack';

const pack = promptPackFor('BD');
const history: ChatLine[] = [
  { from: 'customer', text: 'red saree ache?' },
  { from: 'assistant', text: 'Yes, the red Jamdani is 2,500 taka.' },
  { from: 'customer', text: 'ok 2 ta dao' },
  { from: 'customer', text: 'Mirpur e' },
];

type SystemOne = JevIntentOptions['client']['systemOne'];

/** A client whose one call answers `answer`, rejects with it, or hangs until aborted. */
function classifier(answer: object | Error | 'hang', timeoutMs = 2_000) {
  const systemOne = jest.fn((_request: SystemOneRequest, options?: { signal?: AbortSignal }) => {
    if (answer === 'hang') {
      return new Promise((_, reject) =>
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason)),
      );
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  const jev = new JevIntentClassifier({
    client: { systemOne: systemOne as unknown as SystemOne },
    model: 'jev-1.14.0',
    timeoutMs,
  });
  return { jev, systemOne };
}

const ORDER_ANSWER = {
  model: 'jev-1.14.0',
  usage: { input_tokens: 210, output_tokens: 7 },
  answers: {
    intent: {
      type: 'choice',
      choice: 'order',
      confidence: 0.4,
      probabilities: {
        browse: 0.02,
        order: 0.81,
        ask_question: 0.05,
        edit_order: 0.08,
        complain: 0.01,
        request_human: 0.01,
        other: 0.02,
      },
    },
  },
};

beforeAll(() => Logger.overrideLogger(false));

describe('classifyIntentState', () => {
  it("splits the customer's newest messages from the chat before them", () => {
    expect(classifyIntentState(history, pack)).toEqual({
      chat_languages: 'Bangla, Banglish (Bangla in Latin letters) or English',
      earlier_chat: [
        { from: 'customer', text: 'red saree ache?' },
        { from: 'shop', text: 'Yes, the red Jamdani is 2,500 taka.' },
      ],
      latest_customer_messages: ['ok 2 ta dao', 'Mirpur e'],
    });
  });

  it('leaves out the earlier chat when the customer has only just written', () => {
    expect(classifyIntentState([{ from: 'customer', text: 'hi' }], pack)).toEqual({
      chat_languages: pack.chatLanguages,
      latest_customer_messages: ['hi'],
    });
  });
});

describe('JevIntentClassifier', () => {
  it("returns the chosen intent with that intent's probability, not Jev's confidence", async () => {
    const { jev, systemOne } = classifier(ORDER_ANSWER);
    const result = await jev.classifyIntent(history, pack);

    expect(result).toEqual({
      ok: true,
      value: { intent: 'order', confidence: 0.81 },
      usage: expect.objectContaining({
        purpose: 'classify',
        model: 'jev-1.14.0',
        inputTokens: 210,
        outputTokens: 7,
        promptPack: 'bn-BD',
      }),
    });
    const [request] = systemOne.mock.calls[0]!;
    expect(request.model).toBe('jev-1.14.0');
    expect(request.state).toEqual(classifyIntentState(history, pack));
  });

  it('answers a provider error as a failure instead of throwing, and logs no chat', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { jev } = classifier(new InternalServerError(500, 'boom', new Headers()));
      const result = await jev.classifyIntent(history, pack);

      expect(result).toMatchObject({ ok: false, reason: 'provider_error' });
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain('InternalServerError 500');
      expect(line).not.toContain('Mirpur');
    } finally {
      warn.mockRestore();
    }
  });

  it('gives up at the timeout', async () => {
    const { jev } = classifier('hang', 50);
    await expect(jev.classifyIntent(history, pack)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
      usage: { model: 'jev-1.14.0', inputTokens: null },
    });
  });

  it('rejects an intent outside the schema as invalid output', async () => {
    const { jev } = classifier({
      ...ORDER_ANSWER,
      answers: {
        intent: { ...ORDER_ANSWER.answers.intent, choice: 'refund', probabilities: { refund: 1 } },
      },
    });
    await expect(jev.classifyIntent(history, pack)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_output',
    });
  });
});
