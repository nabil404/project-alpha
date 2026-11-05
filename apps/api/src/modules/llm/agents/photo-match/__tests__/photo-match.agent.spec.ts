import { Logger } from '@nestjs/common';
import { mockModel, sentTo } from '../../../__tests__/mock-model';
import { AiSdkPhotoMatchAgent, type PhotoMatchRequest } from '../photo-match.agent';
import { MATCH_PRODUCT_PHOTO_SYSTEM } from '../photo-match.prompt';

const request: PhotoMatchRequest = {
  photos: ['https://media.example.test/c/org/m1-0.jpg'],
  candidates: [
    { number: 1, name: 'Jamdani Saree', imageUrl: 'https://media.example.test/m/a-thumb.jpg' },
  ],
  words: 'do you have this?',
};

beforeAll(() => Logger.overrideLogger(false));

describe('AiSdkPhotoMatchAgent', () => {
  it('asks its model with each image as a url, and reads the matches', async () => {
    const model = mockModel('mock-extraction', '{"matches":[{"candidate":1,"confidence":0.83}]}');
    const agent = new AiSdkPhotoMatchAgent({ model, timeoutMs: 2_000 });

    await expect(agent.run(request)).resolves.toMatchObject({
      ok: true,
      value: { matches: [{ candidate: 1, confidence: 0.83 }] },
      usage: { purpose: 'vision_match', model: 'mock-extraction', promptPack: null },
    });
    const sent = sentTo(model);
    expect(sent.system).toBe(MATCH_PRODUCT_PHOTO_SYSTEM);
    expect(sent.files.map((part) => part.data)).toEqual([
      expect.objectContaining({ type: 'url' }),
      expect.objectContaining({ type: 'url' }),
    ]);
  });

  it('reads a confidence out of bounds as invalid output', async () => {
    const model = mockModel('mock-extraction', '{"matches":[{"candidate":1,"confidence":7}]}');
    await expect(
      new AiSdkPhotoMatchAgent({ model, timeoutMs: 2_000 }).run(request),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid_output' });
  });
});
