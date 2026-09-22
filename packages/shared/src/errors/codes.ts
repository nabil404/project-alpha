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

  // Tenancy
  'TENANT_NO_ACTIVE_MERCHANT',

  // Messenger webhook
  'WEBHOOK_VERIFICATION_FAILED',
  'WEBHOOK_MISSING_RAW_BODY',
  'WEBHOOK_INVALID_SIGNATURE',
  'WEBHOOK_MALFORMED_PAYLOAD',

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
