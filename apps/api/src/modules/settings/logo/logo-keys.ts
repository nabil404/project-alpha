import type { PutOptions } from '../../storage/object-storage';

/** Objects are never overwritten - a new logo is a new key - so caches may keep them forever. */
export const LOGO_OBJECT_OPTIONS: PutOptions = {
  contentType: 'image/jpeg',
  cacheControl: 'public, max-age=31536000, immutable',
};

const MERCHANT_ID = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOGO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

function logoPrefix(merchantId: string): string {
  if (!MERCHANT_ID.test(merchantId)) {
    throw new Error('logoKey: merchantId would not round-trip');
  }
  return `o/${merchantId}/logo/`;
}

/**
 * Built only here, from the session's merchant id and a server-made uuid -
 * never from anything in a request. Lives outside `m/`, which the product
 * image sweep lists and would otherwise treat as orphans.
 */
export function logoKey(merchantId: string, logoId: string): string {
  if (!UUID.test(logoId)) {
    throw new Error('logoKey: logoId is not a uuid');
  }
  return `${logoPrefix(merchantId)}${logoId}.jpg`;
}

/**
 * The key behind `url` when it is this shop's logo in our bucket, or null.
 * The only place a stored logo URL is parsed.
 */
export function logoKeyFromUrl(
  publicUrl: (key: string) => string,
  merchantId: string,
  url: string,
): string | null {
  const prefix = logoPrefix(merchantId);
  const urlPrefix = publicUrl(prefix);
  if (!url.startsWith(urlPrefix)) {
    return null;
  }
  const file = url.slice(urlPrefix.length);
  return LOGO_FILE.test(file) ? `${prefix}${file}` : null;
}
