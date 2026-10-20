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

/** The product changed after the page read it; saving would overwrite that change. */
export const productStale = (id: string) =>
  new CodedConflictException('PRODUCT_STALE', 'The product changed since it was read', { id });

/** Order lines (or anything else) still reference its variants; the seller archives instead. */
export const productInUse = (id: string) =>
  new CodedConflictException(
    'PRODUCT_IN_USE',
    'The product is referenced by orders; archive it instead',
    { id },
  );

/** An active product needs a price on every live variant. */
export const productPriceMissing = (variant: { id: string; name: string }) =>
  new CodedConflictException(
    'PRODUCT_PRICE_MISSING',
    'An active product needs a price on every variant',
    {
      variantId: variant.id,
      name: variant.name,
    },
  );

/** An active product needs a stock on every live variant. */
export const productStockMissing = (variant: { id: string; name: string }) =>
  new CodedConflictException(
    'PRODUCT_STOCK_MISSING',
    'An active product needs a stock on every variant',
    {
      variantId: variant.id,
      name: variant.name,
    },
  );

/**
 * Refuses an active product with a live variant missing a price or a stock.
 * Draft and archived products may leave either empty. A check constraint
 * cannot see the product's status, so every write that can make or keep a
 * product active calls this with the variants as they will be.
 */
export function assertSellableWhenActive(
  status: 'draft' | 'active' | 'archived',
  variants: readonly { id: string; label: string; price: number | null; stock: number | null }[],
): void {
  if (status !== 'active') return;
  const unpriced = variants.find((variant) => variant.price === null);
  if (unpriced) throw productPriceMissing({ id: unpriced.id, name: unpriced.label });
  const unstocked = variants.find((variant) => variant.stock === null);
  if (unstocked) throw productStockMissing({ id: unstocked.id, name: unstocked.label });
}

/** The seller set a variant's stock below what drafted orders hold. */
export const variantStockReserved = (variant: { id: string; name: string; reserved: number }) =>
  new CodedConflictException(
    'VARIANT_STOCK_RESERVED',
    'Drafted orders reserve more of this variant than the new stock',
    { variantId: variant.id, name: variant.name, reserved: variant.reserved },
  );

/**
 * Refuses the first variant whose new stock is below what drafted orders
 * reserve. `current` must be read under the product's lock: every
 * reservation change locks the product first, so the counts cannot move
 * before the write. A variant without a new stock, or a new variant, passes.
 */
export function assertStockCoversReserved(
  current: readonly { id: string; reserved: number; label: string }[],
  next: readonly { id?: string | null; stock?: number | null }[],
): void {
  const byId = new Map(current.map((variant) => [variant.id, variant]));
  for (const { id, stock } of next) {
    const held = id ? byId.get(id) : undefined;
    // An empty stock holds nothing, so it cannot cover a reservation either.
    if (held && stock !== undefined && (stock ?? 0) < held.reserved) {
      throw variantStockReserved({ id: held.id, name: held.label, reserved: held.reserved });
    }
  }
}

export const productImageNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_IMAGE_NOT_FOUND', 'Image not found', { id });

/** An option or option value id a save names that is not on this product. */
export const productOptionNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_OPTION_NOT_FOUND', 'Option or option value not found', {
    id,
  });

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
