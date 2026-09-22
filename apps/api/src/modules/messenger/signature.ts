import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Every Meta webhook request is signature-verified. The HMAC is computed over
 * the raw body, so the route must keep the unparsed buffer.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');

  return received.length === expected.length && timingSafeEqual(received, expected);
}
