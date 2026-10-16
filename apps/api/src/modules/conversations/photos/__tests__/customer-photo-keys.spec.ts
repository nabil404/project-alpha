import { PRODUCT_IMAGE_KEY_ROOT } from '../../../products/images/product-image-keys';
import { CUSTOMER_PHOTO_KEY_ROOT, customerPhotoKey } from '../customer-photo-keys';

const MESSAGE = '3f1c2b9e-8d7a-4c6b-9e5f-1a2b3c4d5e6f';

describe('customerPhotoKey', () => {
  it('is one fixed key per photo of a message', () => {
    expect(customerPhotoKey('org_A1', MESSAGE, 2)).toBe(`c/org_A1/${MESSAGE}-2.jpg`);
    expect(customerPhotoKey('org_A1', MESSAGE, 2)).toBe(customerPhotoKey('org_A1', MESSAGE, 2));
  });

  it('never lands under the product images the orphan sweep deletes', () => {
    expect(CUSTOMER_PHOTO_KEY_ROOT).not.toBe(PRODUCT_IMAGE_KEY_ROOT);
    expect(customerPhotoKey('org', MESSAGE, 0).startsWith(PRODUCT_IMAGE_KEY_ROOT)).toBe(false);
  });

  it.each([
    ['../org', MESSAGE, 0],
    ['org', 'not-a-uuid', 0],
    ['org', MESSAGE, 1.5],
  ])('refuses ids that would not round-trip: %p %p %p', (merchant, message, index) => {
    expect(() => customerPhotoKey(merchant, message, index)).toThrow();
  });
});
