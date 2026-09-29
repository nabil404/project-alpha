import { decodeCursor, encodeCursor } from '../cursor';

describe('cursor', () => {
  it('round-trips a key to the millisecond', () => {
    const key = {
      at: new Date('2026-09-29T10:05:01.234Z'),
      id: '6f1c2b1e-4a53-4d4e-9d7a-1b2c3d4e5f60',
    };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('is opaque and URL-safe', () => {
    const cursor = encodeCursor({ at: new Date(), id: '6f1c2b1e-4a53-4d4e-9d7a-1b2c3d4e5f60' });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects anything this API did not issue', () => {
    expect(decodeCursor('garbage')).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"at":"yesterday","id":"x"}').toString('base64url')),
    ).toBeNull();
    expect(decodeCursor(Buffer.from('[]').toString('base64url'))).toBeNull();
  });
});
