import { generateSku, normalizeSku } from '../sku';

describe('normalizeSku', () => {
  it('trims and upper-cases', () => {
    expect(normalizeSku('  ab-12x ')).toBe('AB-12X');
  });

  it('treats blank and missing as "generate one"', () => {
    expect(normalizeSku('   ')).toBeNull();
    expect(normalizeSku('')).toBeNull();
    expect(normalizeSku(undefined)).toBeNull();
    expect(normalizeSku(null)).toBeNull();
  });
});

describe('generateSku', () => {
  it('is SKU- plus 8 Crockford base32 characters', () => {
    expect(generateSku()).toMatch(/^SKU-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('is already normalized', () => {
    const sku = generateSku();
    expect(normalizeSku(sku)).toBe(sku);
  });

  it('does not repeat across a batch', () => {
    const batch = new Set(Array.from({ length: 500 }, () => generateSku()));
    expect(batch.size).toBe(500);
  });
});
