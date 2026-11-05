import { Logger } from '@nestjs/common';
import { mockModel, sentTo, telemetryRecorder } from '../../../__tests__/mock-model';
import type { ChatLine } from '../../../llm.types';
import { promptPackFor } from '../../../prompts/prompt-pack';
import { transcript } from '../../../prompts/transcript';
import { AiSdkIntentAgent } from '../intent.agent';
import { classifyIntentSystem } from '../intent.prompt';

const history: ChatLine[] = [{ from: 'customer', text: 'I want the red saree, 2 pcs' }];
const pack = promptPackFor('BD');

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkIntentAgent', () => {
  it('classifies with its model, sending the system prompt and the transcript', async () => {
    const model = mockModel('mock-routing', '{"intent":"order","confidence":0.9}');
    const agent = new AiSdkIntentAgent({ model, timeoutMs: 2_000 });

    await expect(agent.run({ history, pack })).resolves.toEqual({
      ok: true,
      value: { intent: 'order', confidence: 0.9 },
      usage: expect.objectContaining({
        purpose: 'classify',
        model: 'mock-routing',
        inputTokens: 12,
        outputTokens: 5,
        promptPack: 'bn-BD',
      }),
    });
    expect(sentTo(model)).toMatchObject({
      system: classifyIntentSystem(pack),
      text: transcript(history),
    });
  });

  it('traces under its purpose when given telemetry', async () => {
    const telemetry = telemetryRecorder();
    const model = mockModel('mock-routing', '{"intent":"order","confidence":0.9}');
    await new AiSdkIntentAgent({ model, timeoutMs: 2_000, telemetry }).run({ history, pack });
    expect(telemetry.seen).toEqual(['classify']);
  });
});
