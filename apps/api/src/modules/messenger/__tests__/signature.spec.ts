import { createHmac } from 'node:crypto';
import { verifyMetaSignature } from '../signature.js';

const secret = 'app-secret';
const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
const sign = (buf: Buffer) => `sha256=${createHmac('sha256', secret).update(buf).digest('hex')}`;

describe('verifyMetaSignature', () => {
  it('accepts a signature over the raw body', () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects a body that changed after signing', () => {
    expect(verifyMetaSignature(Buffer.from('{"object":"page"}'), sign(body), secret)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', secret)).toBe(false);
  });

  it('rejects a signature from another app secret', () => {
    const other = `sha256=${createHmac('sha256', 'other').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, other, secret)).toBe(false);
  });
});
