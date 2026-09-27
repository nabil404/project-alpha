import {
  CodedBadRequestException,
  CodedConflictException,
  CodedNotFoundException,
} from '../../common/errors/index.js';
import { uniqueViolationConstraint } from '../../database/pg-errors.js';
import { VARIANT_SKU_LIVE_UIDX } from '../../database/schema/index.js';

export const productNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_NOT_FOUND', 'Product not found', { id });

export const variantNotFound = (id: string) =>
  new CodedNotFoundException('VARIANT_NOT_FOUND', 'Variant not found', { id });

export const variantNameRequired = () =>
  new CodedBadRequestException(
    'VARIANT_NAME_REQUIRED',
    'Every variant needs a name when a product has more than one',
  );

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
