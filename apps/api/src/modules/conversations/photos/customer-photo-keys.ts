/**
 * Customers' photos live under this prefix, never under `m/`: the product
 * image sweep deletes any `m/` object without a product_image row.
 */
export const CUSTOMER_PHOTO_KEY_ROOT = 'c/';

const MERCHANT_ID = /^[A-Za-z0-9_-]+$/;
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One key per photo of a message, from our own ids. It is the same key on
 * every attempt, so a retry, or the turn and the copy job racing, overwrite
 * one object with the same photo instead of leaving a second behind.
 */
export function customerPhotoKey(merchantId: string, messageId: string, index: number): string {
  if (!MERCHANT_ID.test(merchantId) || !MESSAGE_ID.test(messageId) || !Number.isInteger(index)) {
    throw new Error('customerPhotoKey: merchantId, messageId or index would not round-trip');
  }
  return `${CUSTOMER_PHOTO_KEY_ROOT}${merchantId}/${messageId}-${index}.jpg`;
}
