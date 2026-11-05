import { Logger } from '@nestjs/common';
import { mockModel, sentTo, telemetryRecorder } from '../../../__tests__/mock-model';
import type { ChatLine } from '../../../llm.types';
import { promptPackFor } from '../../../prompts/prompt-pack';
import { AiSdkReplyPhrasingAgent, type PhraseRequest } from '../reply-phrasing.agent';
import { phraseReplyPrompt, phraseReplySystem } from '../reply-phrasing.prompt';

const history: ChatLine[] = [{ from: 'customer', text: 'I want the red saree, 2 pcs' }];
const request: PhraseRequest = {
  instruction: 'Ask which colour.',
  facts: { productName: 'Red saree' },
  language: 'en',
  matchCustomer: true,
  tone: 'friendly',
  pack: promptPackFor('BD'),
};

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkReplyPhrasingAgent', () => {
  it('phrases with its model and trims the text', async () => {
    const model = mockModel('mock-routing', '  Which colour would you like?  ');
    const agent = new AiSdkReplyPhrasingAgent({ model, timeoutMs: 2_000 });

    await expect(agent.run({ request, history })).resolves.toMatchObject({
      ok: true,
      value: 'Which colour would you like?',
      usage: { purpose: 'phrase', model: 'mock-routing', promptPack: 'bn-BD' },
    });
    expect(sentTo(model)).toMatchObject({
      system: phraseReplySystem(request.pack),
      text: phraseReplyPrompt(request, history),
    });
  });

  it('traces under its purpose when given telemetry', async () => {
    const telemetry = telemetryRecorder();
    const model = mockModel('mock-routing', 'Hello!');
    await new AiSdkReplyPhrasingAgent({ model, timeoutMs: 2_000, telemetry }).run({
      request,
      history,
    });
    expect(telemetry.seen).toEqual(['phrase']);
  });
});
