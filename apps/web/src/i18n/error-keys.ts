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
  AUTH_EMAIL_NOT_VERIFIED: 'code.AUTH_EMAIL_NOT_VERIFIED',
  AUTH_INVALID_TOKEN: 'code.AUTH_INVALID_TOKEN',
  AUTH_ACCOUNT_NOT_LINKED: 'code.AUTH_ACCOUNT_NOT_LINKED',
  AUTH_SOCIAL_CANCELLED: 'code.AUTH_SOCIAL_CANCELLED',
  AUTH_SOCIAL_EMAIL_MISMATCH: 'code.AUTH_SOCIAL_EMAIL_MISMATCH',
  AUTH_SOCIAL_ACCOUNT_TAKEN: 'code.AUTH_SOCIAL_ACCOUNT_TAKEN',
  AUTH_SOCIAL_FAILED: 'code.AUTH_SOCIAL_FAILED',
  AUTH_LAST_SIGN_IN_METHOD: 'code.AUTH_LAST_SIGN_IN_METHOD',
  AUTH_SESSION_NOT_FRESH: 'code.AUTH_SESSION_NOT_FRESH',
  AUTH_WRONG_PASSWORD: 'code.AUTH_WRONG_PASSWORD',
  AVATAR_UNSUPPORTED_TYPE: 'code.AVATAR_UNSUPPORTED_TYPE',
  AVATAR_INVALID: 'code.AVATAR_INVALID',
  AVATAR_TOO_LARGE: 'code.AVATAR_TOO_LARGE',
  AVATAR_TOO_SMALL: 'code.AVATAR_TOO_SMALL',
  SESSION_NOT_FOUND: 'code.SESSION_NOT_FOUND',
  SESSION_IS_CURRENT: 'code.SESSION_IS_CURRENT',
  TENANT_NO_ACTIVE_MERCHANT: 'code.TENANT_NO_ACTIVE_MERCHANT',
  WEBHOOK_VERIFICATION_FAILED: 'code.WEBHOOK_VERIFICATION_FAILED',
  WEBHOOK_MISSING_RAW_BODY: 'code.WEBHOOK_MISSING_RAW_BODY',
  WEBHOOK_INVALID_SIGNATURE: 'code.WEBHOOK_INVALID_SIGNATURE',
  WEBHOOK_MALFORMED_PAYLOAD: 'code.WEBHOOK_MALFORMED_PAYLOAD',
  MESSENGER_NOT_CONFIGURED: 'code.MESSENGER_NOT_CONFIGURED',
  FACEBOOK_AUTH_CANCELLED: 'code.FACEBOOK_AUTH_CANCELLED',
  FACEBOOK_AUTH_EXPIRED: 'code.FACEBOOK_AUTH_EXPIRED',
  FACEBOOK_AUTH_FAILED: 'code.FACEBOOK_AUTH_FAILED',
  FACEBOOK_PERMISSIONS_DECLINED: 'code.FACEBOOK_PERMISSIONS_DECLINED',
  FACEBOOK_UNAVAILABLE: 'code.FACEBOOK_UNAVAILABLE',
  FACEBOOK_PAGE_NOT_FOUND: 'code.FACEBOOK_PAGE_NOT_FOUND',
  FACEBOOK_PAGE_NO_MESSAGING_ACCESS: 'code.FACEBOOK_PAGE_NO_MESSAGING_ACCESS',
  FACEBOOK_PAGE_TAKEN: 'code.FACEBOOK_PAGE_TAKEN',
  FACEBOOK_PAGE_ALREADY_CONNECTED: 'code.FACEBOOK_PAGE_ALREADY_CONNECTED',
  STORAGE_UNAVAILABLE: 'code.STORAGE_UNAVAILABLE',
  CONVERSATION_NOT_FOUND: 'code.CONVERSATION_NOT_FOUND',
  MESSENGER_WINDOW_CLOSED: 'code.MESSENGER_WINDOW_CLOSED',
  MESSENGER_SEND_FAILED: 'code.MESSENGER_SEND_FAILED',
  MESSENGER_PAGE_NOT_CONNECTED: 'code.MESSENGER_PAGE_NOT_CONNECTED',
  MESSAGE_NOT_FOUND: 'code.MESSAGE_NOT_FOUND',
  MESSAGE_NOT_DELETABLE: 'code.MESSAGE_NOT_DELETABLE',
  PRODUCT_NOT_FOUND: 'code.PRODUCT_NOT_FOUND',
  PRODUCT_IMAGE_UNSUPPORTED_TYPE: 'code.PRODUCT_IMAGE_UNSUPPORTED_TYPE',
  PRODUCT_IMAGE_INVALID: 'code.PRODUCT_IMAGE_INVALID',
  PRODUCT_IMAGE_TOO_LARGE: 'code.PRODUCT_IMAGE_TOO_LARGE',
  PRODUCT_IMAGE_LIMIT_REACHED: 'code.PRODUCT_IMAGE_LIMIT_REACHED',
  PRODUCT_IMAGE_ORDER_MISMATCH: 'code.PRODUCT_IMAGE_ORDER_MISMATCH',
  PRODUCT_IMAGE_NOT_FOUND: 'code.PRODUCT_IMAGE_NOT_FOUND',
  PRODUCT_OPTION_NOT_FOUND: 'code.PRODUCT_OPTION_NOT_FOUND',
  PRODUCT_STALE: 'code.PRODUCT_STALE',
  PRODUCT_IN_USE: 'code.PRODUCT_IN_USE',
  VARIANT_NOT_FOUND: 'code.VARIANT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'code.CATEGORY_NOT_FOUND',
  CATEGORY_NAME_TAKEN: 'code.CATEGORY_NAME_TAKEN',
  SKU_TAKEN: 'code.SKU_TAKEN',
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
  INVALID_PHONE: 'field.INVALID_PHONE',
  DUPLICATE: 'field.DUPLICATE',
  UNKNOWN_OPTION_VALUE: 'field.UNKNOWN_OPTION_VALUE',
  OPTION_VALUES_MISMATCH: 'field.OPTION_VALUES_MISMATCH',
  VARIANTS_NEED_OPTION: 'field.VARIANTS_NEED_OPTION',
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
    /** The message for a bare code, such as one a redirect put in the URL. */
    forCode,

    /** The headline message for a failed request. */
    forError: (error: unknown): string =>
      error instanceof ApiError ? forCode(error.code, error.params) : t('generic'),

    /** The message for one rule failure on one form control. */
    forField: (fieldError: ParsedFieldError): string => forCode(fieldError.code, fieldError.params),
  };
}
