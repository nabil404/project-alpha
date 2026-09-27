import type { PutOptions } from '../../storage/object-storage';

/** Every product image object lives under this prefix; the cleanup job lists only it. */
export const PRODUCT_IMAGE_KEY_ROOT = 'm/';

/** Objects are never overwritten - a new photo is a new key - so caches may keep them forever. */
export const PRODUCT_IMAGE_OBJECT_OPTIONS: PutOptions = {
  contentType: 'image/jpeg',
  cacheControl: 'public, max-age=31536000, immutable',
};

const MERCHANT_ID = /^[A-Za-z0-9_-]+$/;
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY =
  /^m\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-thumb)?\.jpg$/;

/**
 * Keys are built only here, from the session's merchant id and a server-made
 * uuid - never from anything in a request. The merchant prefix is what lets the
 * cleanup job recover whose object it is looking at.
 */
export function productImageKeys(
  merchantId: string,
  imageId: string,
): { full: string; thumbnail: string } {
  if (!MERCHANT_ID.test(merchantId) || !IMAGE_ID.test(imageId)) {
    throw new Error('productImageKeys: merchantId or imageId would not round-trip');
  }
  return {
    full: `m/${merchantId}/${imageId}.jpg`,
    thumbnail: `m/${merchantId}/${imageId}-thumb.jpg`,
  };
}

/** The inverse of productImageKeys, or null for any key it could not have produced. */
export function parseProductImageKey(
  key: string,
): { merchantId: string; imageId: string; kind: 'full' | 'thumbnail' } | null {
  const match = KEY.exec(key);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { merchantId: match[1], imageId: match[2], kind: match[3] ? 'thumbnail' : 'full' };
}
