import { Logger } from '@nestjs/common';
import { mockModel, sentTo, telemetryRecorder } from '../../../__tests__/mock-model';
import type { ChatLine } from '../../../llm.types';
import { promptPackFor } from '../../../prompts/prompt-pack';
import { AiSdkOrderExtractionAgent, type ExtractionContext } from '../order-extraction.agent';
import { extractOrderPrompt, extractOrderSystem } from '../order-extraction.prompt';

const history: ChatLine[] = [{ from: 'customer', text: 'I want the red saree, 2 pcs' }];
const pack = promptPackFor('BD');
const context: ExtractionContext = { items: [] };

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

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkOrderExtractionAgent', () => {
  it('extracts with its model, sending what is already collected and the transcript', async () => {
    const model = mockModel('mock-extraction', ORDER);
    const agent = new AiSdkOrderExtractionAgent({ model, timeoutMs: 2_000 });

    await expect(agent.run({ history, context, pack })).resolves.toMatchObject({
      ok: true,
      value: { items: [RED_SAREE], confidence: 0.92 },
      usage: { purpose: 'extract', model: 'mock-extraction', promptPack: 'bn-BD' },
    });
    expect(sentTo(model)).toMatchObject({
      system: extractOrderSystem(pack),
      text: extractOrderPrompt(history, context),
    });
  });

  it('traces under its purpose when given telemetry', async () => {
    const telemetry = telemetryRecorder();
    const model = mockModel('mock-extraction', ORDER);
    await new AiSdkOrderExtractionAgent({ model, timeoutMs: 2_000, telemetry }).run({
      history,
      context,
      pack,
    });
    expect(telemetry.seen).toEqual(['extract']);
  });
});
