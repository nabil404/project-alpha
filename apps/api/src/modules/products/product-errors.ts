import { PRODUCT_IMAGE_MAX_COUNT } from '@app/shared';
import {
  CodedBadRequestException,
  CodedConflictException,
  CodedNotFoundException,
  CodedUnsupportedMediaTypeException,
} from '../../common/errors/index';
import { uniqueViolationConstraint } from '../database/pg-errors';
import { VARIANT_SKU_LIVE_UIDX } from '../database/schema/index';

export const productNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_NOT_FOUND', 'Product not found', { id });

export const variantNotFound = (id: string) =>
  new CodedNotFoundException('VARIANT_NOT_FOUND', 'Variant not found', { id });

export const variantNameRequired = () =>
  new CodedBadRequestException(
    'VARIANT_NAME_REQUIRED',
    'Every variant needs a name when a product has more than one',
  );

/** Spec rule: "A product with no live variant cannot exist." */
export const productNeedsVariant = (id?: string) =>
  new CodedConflictException(
    'PRODUCT_NEEDS_VARIANT',
    'A product needs at least one variant',
    id ? { id } : {},
  );

export const productImageNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_IMAGE_NOT_FOUND', 'Image not found', { id });

export const productImageLimitReached = () =>
  new CodedConflictException(
    'PRODUCT_IMAGE_LIMIT_REACHED',
    'Product already has the maximum number of images',
    { max: PRODUCT_IMAGE_MAX_COUNT },
  );

export const productImageOrderMismatch = () =>
  new CodedBadRequestException(
    'PRODUCT_IMAGE_ORDER_MISMATCH',
    "imageIds must list each of the product's images exactly once",
  );

export const productImageUnsupported = () =>
  new CodedUnsupportedMediaTypeException(
    'PRODUCT_IMAGE_UNSUPPORTED_TYPE',
    'Only JPEG, PNG and WebP images are accepted',
  );

export const productImageInvalid = () =>
  new CodedBadRequestException('PRODUCT_IMAGE_INVALID', 'The file is not a usable image');

/**
 * Maps the live-SKU unique index to SKU_TAKEN for a SKU the seller typed.
 * Generated SKUs never reach here: the repository retries those with ON
 * CONFLICT DO NOTHING instead.
 */
export async function guardSku<T>(
  sku: string | null | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (sku && uniqueViolationConstraint(error) === VARIANT_SKU_LIVE_UIDX) {
      throw new CodedConflictException('SKU_TAKEN', 'Another variant already uses this SKU', {
        sku,
      });
    }
    throw error;
  }
}
