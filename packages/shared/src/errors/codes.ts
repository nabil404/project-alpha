import { z } from 'zod';

/**
 * Stable, machine-readable error codes. The API never sends translated prose:
 * the SPA resolves a code through its own catalog and interpolates `params`,
 * so a code is part of the contract and renaming one is a breaking change.
 *
 * Add a code when a call site actually throws it. An unused code is a catalog
 * entry the frontend carries forever for nothing.
 */
export const errorCodes = [
  // Generic
  'INTERNAL_SERVER_ERROR',
  'VALIDATION_FAILED',

  // Auth
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_UNAUTHENTICATED',
  'AUTH_EMAIL_NOT_VERIFIED',
  'AUTH_INVALID_TOKEN',

  // Tenancy
  'TENANT_NO_ACTIVE_MERCHANT',

  // Messenger webhook
  'WEBHOOK_VERIFICATION_FAILED',
  'WEBHOOK_MISSING_RAW_BODY',
  'WEBHOOK_INVALID_SIGNATURE',
  'WEBHOOK_MALFORMED_PAYLOAD',

  // Facebook Page connection
  'MESSENGER_NOT_CONFIGURED',
  'FACEBOOK_AUTH_CANCELLED',
  'FACEBOOK_AUTH_EXPIRED',
  'FACEBOOK_AUTH_FAILED',
  'FACEBOOK_PERMISSIONS_DECLINED',
  'FACEBOOK_UNAVAILABLE',
  'FACEBOOK_PAGE_NOT_FOUND',
  'FACEBOOK_PAGE_NO_MESSAGING_ACCESS',
  'FACEBOOK_PAGE_TAKEN',
  'FACEBOOK_PAGE_ALREADY_CONNECTED',

  // Object storage
  'STORAGE_UNAVAILABLE',

  // Catalog
  'PRODUCT_NOT_FOUND',
  'VARIANT_NOT_FOUND',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_CYCLE',
  'CATEGORY_TOO_DEEP',
  'CATEGORY_HAS_CHILDREN',
  'CATEGORY_NAME_TAKEN',
  'PRODUCT_NEEDS_VARIANT',
  'VARIANT_NAME_REQUIRED',
  'SKU_TAKEN',
  'PRODUCT_IMAGE_UNSUPPORTED_TYPE',
  'PRODUCT_IMAGE_INVALID',
  'PRODUCT_IMAGE_TOO_LARGE',
  'PRODUCT_IMAGE_LIMIT_REACHED',
  'PRODUCT_IMAGE_ORDER_MISMATCH',
  'PRODUCT_IMAGE_NOT_FOUND',

  // Field-level, derived from Zod issues
  'REQUIRED',
  'INVALID_TYPE',
  'MIN_LENGTH',
  'MAX_LENGTH',
  'MIN_ITEMS',
  'MAX_ITEMS',
  'MIN_VALUE',
  'MAX_VALUE',
  'INVALID_FORMAT',
  'INVALID_VALUE',
  'NOT_MULTIPLE_OF',
  'UNRECOGNIZED_KEYS',
  'INVALID_INPUT',
  'INVALID_PHONE',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * What can appear as `error.code` on the wire. The global filter synthesizes
 * `HTTP_<status>` for framework-thrown exceptions nobody gave a code to —
 * Nest's own 404 for an unmatched route, say — so the envelope stays
 * consistent even on paths this design never touched.
 */
export type WireErrorCode = ErrorCode | `HTTP_${number}`;

const knownCodes: ReadonlySet<string> = new Set(errorCodes);

/**
 * Narrows a code read off the wire. Deliberately takes a plain string: a
 * client running against a newer API will see codes it has never heard of,
 * and that has to degrade to a generic message rather than throw.
 */
export function isErrorCode(value: string): value is ErrorCode {
  return knownCodes.has(value);
}
