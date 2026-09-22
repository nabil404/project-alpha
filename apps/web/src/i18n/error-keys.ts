import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { isErrorCode, type ErrorCode, type ParsedFieldError } from '@app/shared';

import { ApiError } from '@/lib/api-error';

/**
 * Every ErrorCode the API can send must name a key in errors.json.
 *
 * `satisfies Record<ErrorCode, ParseKeys<'errors'>>` fails the typecheck twice
 * over, the same way i18n/status-keys.ts does: once if a code added in
 * packages/shared has no entry here, and once if an entry points at a key that
 * doesn't exist in locales/en/errors.json. An error toast can't render blank.
 *
 * The WEBHOOK_* codes are server-to-Meta and won't surface in the dashboard.
 * They carry copy anyway because exhaustiveness is what makes the check work —
 * a partial map would stop catching the codes that do reach a seller.
 */
export const errorCodeKeys = {
  INTERNAL_SERVER_ERROR: 'code.INTERNAL_SERVER_ERROR',
  VALIDATION_FAILED: 'code.VALIDATION_FAILED',
  AUTH_INVALID_CREDENTIALS: 'code.AUTH_INVALID_CREDENTIALS',
  AUTH_UNAUTHENTICATED: 'code.AUTH_UNAUTHENTICATED',
  TENANT_NO_ACTIVE_MERCHANT: 'code.TENANT_NO_ACTIVE_MERCHANT',
  WEBHOOK_VERIFICATION_FAILED: 'code.WEBHOOK_VERIFICATION_FAILED',
  WEBHOOK_MISSING_RAW_BODY: 'code.WEBHOOK_MISSING_RAW_BODY',
  WEBHOOK_INVALID_SIGNATURE: 'code.WEBHOOK_INVALID_SIGNATURE',
  WEBHOOK_MALFORMED_PAYLOAD: 'code.WEBHOOK_MALFORMED_PAYLOAD',
  REQUIRED: 'field.REQUIRED',
  INVALID_TYPE: 'field.INVALID_TYPE',
  MIN_LENGTH: 'field.MIN_LENGTH',
  MAX_LENGTH: 'field.MAX_LENGTH',
  MIN_ITEMS: 'field.MIN_ITEMS',
  MAX_ITEMS: 'field.MAX_ITEMS',
  MIN_VALUE: 'field.MIN_VALUE',
  MAX_VALUE: 'field.MAX_VALUE',
  INVALID_FORMAT: 'field.INVALID_FORMAT',
  INVALID_VALUE: 'field.INVALID_VALUE',
  NOT_MULTIPLE_OF: 'field.NOT_MULTIPLE_OF',
  UNRECOGNIZED_KEYS: 'field.UNRECOGNIZED_KEYS',
  INVALID_INPUT: 'field.INVALID_INPUT',
} as const satisfies Record<ErrorCode, ParseKeys<'errors'>>;

/**
 * Read error copy through this, never by hand-writing an error key at a call
 * site. Anything unrecognized — an ApiError from an API deployed ahead of this
 * bundle, or a plain network Error — resolves to one generic sentence instead
 * of leaking the API's English fallback into the UI.
 */
export function useErrorMessages() {
  const { t } = useTranslation('errors');

  const forCode = (code: string, params: Record<string, unknown> = {}): string =>
    isErrorCode(code) ? t(errorCodeKeys[code], params) : t('generic');

  return {
    /** The headline message for a failed request. */
    forError: (error: unknown): string =>
      error instanceof ApiError ? forCode(error.code, error.params) : t('generic'),

    /** The message for one rule failure on one form control. */
    forField: (fieldError: ParsedFieldError): string => forCode(fieldError.code, fieldError.params),
  };
}
