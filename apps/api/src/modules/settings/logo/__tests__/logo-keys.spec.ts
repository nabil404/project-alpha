import { joinPublicUrl } from '../../../storage/object-storage';
import { logoKey, logoKeyFromUrl } from '../logo-keys';

const BASE = 'https://media.example.test';
const publicUrl = (key: string) => joinPublicUrl(BASE, key);
const SHOP = '9fa1785054b43e3b400c82fc68c68b9a';
const LOGO = '0b8c3f1e-2d4a-4c5b-9e6f-7a8b9c0d1e2f';

describe('logoKey', () => {
  it('puts the logo under the shop, outside the product image prefix', () => {
    expect(logoKey(SHOP, LOGO)).toBe(`o/${SHOP}/logo/${LOGO}.jpg`);
  });

  it('refuses ids that would not round-trip', () => {
    expect(() => logoKey('../m/x', LOGO)).toThrow();
    expect(() => logoKey(SHOP, 'not-a-uuid')).toThrow();
  });
});

describe('logoKeyFromUrl', () => {
  it('recovers the key of our own logo', () => {
    const key = logoKey(SHOP, LOGO);
    expect(logoKeyFromUrl(publicUrl, SHOP, publicUrl(key))).toBe(key);
  });

  it("ignores another shop's logo", () => {
    const other = logoKey('other00000000000000000000000000a', LOGO);
    expect(logoKeyFromUrl(publicUrl, SHOP, publicUrl(other))).toBeNull();
  });

  it('ignores a lookalike host and a product image', () => {
    const key = logoKey(SHOP, LOGO);
    expect(
      logoKeyFromUrl(publicUrl, SHOP, `https://media.example.test.evil.test/${key}`),
    ).toBeNull();
    expect(logoKeyFromUrl(publicUrl, SHOP, publicUrl(`m/${SHOP}/${LOGO}.jpg`))).toBeNull();
  });
});
