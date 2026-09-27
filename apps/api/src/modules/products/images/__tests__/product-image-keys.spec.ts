import { parseProductImageKey, productImageKeys } from '../product-image-keys';

const merchantId = 'Xk3nQ8vB2mLp9wRtYs4dFgHj6cZa1eNu';
const imageId = '3f1c2b7a-9d4e-4c61-8a2f-5b7e9c0d1a23';

describe('productImageKeys', () => {
  it('names the full image and its thumbnail under the merchant prefix', () => {
    expect(productImageKeys(merchantId, imageId)).toEqual({
      full: `m/${merchantId}/${imageId}.jpg`,
      thumbnail: `m/${merchantId}/${imageId}-thumb.jpg`,
    });
  });

  it.each([
    ['a merchant id with a slash', 'a/b', imageId],
    ['an empty merchant id', '', imageId],
    ['an image id that is not a uuid', merchantId, 'not-a-uuid'],
  ])('refuses %s', (_label, merchant, image) => {
    expect(() => productImageKeys(merchant, image)).toThrow();
  });
});

describe('parseProductImageKey', () => {
  it('round-trips both kinds', () => {
    const keys = productImageKeys(merchantId, imageId);
    expect(parseProductImageKey(keys.full)).toEqual({ merchantId, imageId, kind: 'full' });
    expect(parseProductImageKey(keys.thumbnail)).toEqual({
      merchantId,
      imageId,
      kind: 'thumbnail',
    });
  });

  it.each([
    `m/${merchantId}/${imageId}.png`,
    `m/${merchantId}/${imageId}-400.jpg`,
    `m/${merchantId}/${imageId}-thumb-thumb.jpg`,
    `x/${merchantId}/${imageId}.jpg`,
    `m/${merchantId}/nested/${imageId}.jpg`,
    `m//${imageId}.jpg`,
    `m/${merchantId}/${imageId.toUpperCase()}.jpg`,
    'm/',
    '',
  ])('returns null for %s', (key) => {
    expect(parseProductImageKey(key)).toBeNull();
  });
});
