import { Logger } from '@nestjs/common';
import { mockModel, sentTo } from '../../../__tests__/mock-model';
import { promptPackFor } from '../../../prompts/prompt-pack';
import { AiSdkPostImportAgent, type PostExtractionRequest } from '../post-import.agent';
import { extractProductsFromPostSystem } from '../post-import.prompt';

const request: PostExtractionRequest = {
  caption: 'New Jamdani, 1250 taka',
  photos: ['https://media.example.test/m/p1.jpg'],
  currency: 'BDT',
  pack: promptPackFor('BD'),
  categories: ['Sarees'],
};

const PRODUCTS = JSON.stringify({
  kind: 'products',
  reason: null,
  products: [
    {
      name: 'Jamdani',
      description: null,
      aliases: [],
      options: [],
      prices: [{ values: [], price: 1250 }],
      category: { kind: 'existing', name: 'Sarees' },
    },
  ],
});

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkPostImportAgent', () => {
  it("reads a post with its model, the post's photos sent as urls", async () => {
    const model = mockModel('mock-extraction', PRODUCTS);
    const agent = new AiSdkPostImportAgent({ model, timeoutMs: 2_000 });

    await expect(agent.run(request)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'products', products: [{ name: 'Jamdani' }] },
      usage: { purpose: 'post_import', model: 'mock-extraction', promptPack: 'bn-BD' },
    });
    const sent = sentTo(model);
    expect(sent.system).toBe(extractProductsFromPostSystem(request.pack));
    expect(sent.files.map((part) => part.data)).toEqual([expect.objectContaining({ type: 'url' })]);
  });

  it('reports a provider error as a failed result', async () => {
    const model = mockModel('mock-extraction', new Error('upstream exploded'));
    await expect(
      new AiSdkPostImportAgent({ model, timeoutMs: 2_000 }).run(request),
    ).resolves.toMatchObject({ ok: false, reason: 'provider_error' });
  });
});
