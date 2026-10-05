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
  // Google/Facebook round trip, from the ?error= Better Auth's callback redirects with
  'AUTH_ACCOUNT_NOT_LINKED',
  'AUTH_SOCIAL_CANCELLED',
  'AUTH_SOCIAL_EMAIL_MISMATCH',
  'AUTH_SOCIAL_ACCOUNT_TAKEN',
  'AUTH_SOCIAL_FAILED',
  // Unlinking a sign-in method
  'AUTH_LAST_SIGN_IN_METHOD',
  'AUTH_SESSION_NOT_FRESH',

  // Settings > Account
  'AUTH_WRONG_PASSWORD',
  'AVATAR_UNSUPPORTED_TYPE',
  'AVATAR_INVALID',
  'AVATAR_TOO_LARGE',
  'AVATAR_TOO_SMALL',
  'SESSION_NOT_FOUND',
  'SESSION_IS_CURRENT',

  // Settings > General
  'CURRENCY_LOCKED',
  'LOGO_UNSUPPORTED_TYPE',
  'LOGO_INVALID',
  'LOGO_TOO_LARGE',
  'LOGO_TOO_SMALL',

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

  // Conversations
  'CONVERSATION_NOT_FOUND',
  'MESSENGER_WINDOW_CLOSED',
  'MESSENGER_SEND_FAILED',
  'MESSENGER_PAGE_NOT_CONNECTED',
  'MESSAGE_NOT_FOUND',
  'MESSAGE_NOT_DELETABLE',

  // Customers
  'CUSTOMER_NOT_FOUND',

  // Orders
  'ORDER_NOT_FOUND',
  'ORDER_STALE',
  'ORDER_INVALID_TRANSITION',
  'ORDER_NOT_EDITABLE',
  'ORDER_INSUFFICIENT_STOCK',

  // Catalog
  'PRODUCT_NOT_FOUND',
  'VARIANT_NOT_FOUND',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_NAME_TAKEN',
  'SKU_TAKEN',
  'PRODUCT_IMAGE_UNSUPPORTED_TYPE',
  'PRODUCT_IMAGE_INVALID',
  'PRODUCT_IMAGE_TOO_LARGE',
  'PRODUCT_IMAGE_LIMIT_REACHED',
  'PRODUCT_IMAGE_ORDER_MISMATCH',
  'PRODUCT_IMAGE_NOT_FOUND',
  'PRODUCT_OPTION_NOT_FOUND',
  'PRODUCT_STALE',
  'PRODUCT_IN_USE',

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
  // Field-level, from the product document's refinements
  'DUPLICATE',
  'UNKNOWN_OPTION_VALUE',
  'OPTION_VALUES_MISMATCH',
  'VARIANTS_NEED_OPTION',
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
