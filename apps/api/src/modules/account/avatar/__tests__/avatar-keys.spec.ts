import { joinPublicUrl } from '../../../storage/object-storage';
import { avatarKey, avatarKeyFromUrl } from '../avatar-keys';

const BASE = 'https://media.example.test';
const publicUrl = (key: string) => joinPublicUrl(BASE, key);
const USER = 'Ab3dEf9hIjKlMnOpQrStUvWxYz012345';
const AVATAR = '0b8c3f1e-2d4a-4c5b-9e6f-7a8b9c0d1e2f';

describe('avatarKey', () => {
  it('puts the avatar under the user', () => {
    expect(avatarKey(USER, AVATAR)).toBe(`u/${USER}/avatar/${AVATAR}.jpg`);
  });

  it('refuses ids that would not round-trip', () => {
    expect(() => avatarKey('../m/x', AVATAR)).toThrow();
    expect(() => avatarKey(USER, 'not-a-uuid')).toThrow();
  });
});

describe('avatarKeyFromUrl', () => {
  it('recovers the key of our own avatar', () => {
    const key = avatarKey(USER, AVATAR);
    expect(avatarKeyFromUrl(publicUrl, USER, publicUrl(key))).toBe(key);
  });

  it('ignores a Google profile photo', () => {
    expect(
      avatarKeyFromUrl(publicUrl, USER, 'https://lh3.googleusercontent.com/a/photo=s96-c'),
    ).toBeNull();
  });

  it("ignores another user's avatar", () => {
    const other = avatarKey('Other0000000000000000000000000000', AVATAR);
    expect(avatarKeyFromUrl(publicUrl, USER, publicUrl(other))).toBeNull();
  });

  it('ignores a lookalike host', () => {
    const key = avatarKey(USER, AVATAR);
    expect(
      avatarKeyFromUrl(publicUrl, USER, `https://media.example.test.evil.test/${key}`),
    ).toBeNull();
  });

  it('ignores a product image in our bucket', () => {
    expect(avatarKeyFromUrl(publicUrl, USER, publicUrl(`m/shop/${AVATAR}.jpg`))).toBeNull();
  });
});
