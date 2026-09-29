import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROOT_FIELD,
  type ErrorBody,
  type ErrorCode,
  type FieldError,
} from '@app/shared';

/**
 * Better Auth writes its own `{ code, message }` JSON straight to the response,
 * past AllExceptionsFilter. This turns that into the API's coded envelope, so
 * the SPA reads /api/v1/auth/* errors exactly as it reads every other endpoint's.
 *
 * Pure on purpose: the after-hook in auth.config.ts is the only caller, and
 * the mapping can be tested without booting Better Auth.
 */

/** The parts of a Better Auth APIError this reads. */
export interface AuthErrorLike {
  statusCode: number;
  body?: { code?: unknown; message?: unknown } | undefined;
}

const direct: Readonly<Record<string, ErrorCode>> = {
  INVALID_EMAIL_OR_PASSWORD: 'AUTH_INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  TOKEN_EXPIRED: 'AUTH_INVALID_TOKEN',
  // /unlink-account: the seller's only sign-in method, or a session older than freshAge.
  FAILED_TO_UNLINK_LAST_ACCOUNT: 'AUTH_LAST_SIGN_IN_METHOD',
  SESSION_NOT_FRESH: 'AUTH_SESSION_NOT_FRESH',
  // /change-password: the current password the seller typed is wrong.
  INVALID_PASSWORD: 'AUTH_WRONG_PASSWORD',
};

/** Endpoints whose password field is `newPassword` rather than `password`. */
const newPasswordPaths: ReadonlySet<string> = new Set(['/reset-password', '/change-password']);

function validation(fields: Record<string, FieldError[]>): ErrorBody {
  return { code: 'VALIDATION_FAILED', message: 'Validation failed', params: {}, fields };
}

/**
 * better-call drops the schema issues from a VALIDATION_ERROR and keeps only a
 * message built from them - `[body.email] Invalid email address; [body.name]
 * Required` - so the field paths are read back out of that. Anything that
 * doesn't parse lands on the body as a whole.
 */
const ISSUE = /^\[(?:body|query)(?:\.([^\]]+))?\]\s*(.*)$/;

function validationFields(message: string): Record<string, FieldError[]> {
  const fields: Record<string, FieldError[]> = {};

  for (const part of message.split('; ')) {
    const match = ISSUE.exec(part);
    const key = match?.[1] ?? ROOT_FIELD;
    const text = match ? (match[2] ?? part) : part;
    (fields[key] ??= []).push({ code: 'INVALID_INPUT', message: text, params: {} });
  }

  return fields;
}

/**
 * @param error the APIError Better Auth produced
 * @param path the Better Auth endpoint path, e.g. `/sign-up/email`
 */
export function toAuthErrorBody(error: AuthErrorLike, path: string): ErrorBody {
  const status = error.statusCode;
  const code = typeof error.body?.code === 'string' ? error.body.code : undefined;
  const message =
    typeof error.body?.message === 'string' && error.body.message.length > 0
      ? error.body.message
      : `Request failed with status ${status}`;

  const mapped = code ? direct[code] : undefined;
  if (mapped) {
    return { code: mapped, message, params: {} };
  }

  const passwordField = newPasswordPaths.has(path) ? 'newPassword' : 'password';

  switch (code) {
    case 'PASSWORD_TOO_SHORT':
      return validation({
        [passwordField]: [{ code: 'MIN_LENGTH', message, params: { min: PASSWORD_MIN_LENGTH } }],
      });

    case 'PASSWORD_TOO_LONG':
      return validation({
        [passwordField]: [{ code: 'MAX_LENGTH', message, params: { max: PASSWORD_MAX_LENGTH } }],
      });

    case 'INVALID_EMAIL':
      // `format: 'email'` is what the Zod-derived INVALID_FORMAT carries too.
      return validation({
        email: [{ code: 'INVALID_FORMAT', message, params: { format: 'email' } }],
      });

    case 'VALIDATION_ERROR':
      return validation(validationFields(message));
  }

  if (status === 401) {
    return { code: 'AUTH_UNAUTHENTICATED', message, params: {} };
  }

  // Whatever Better Auth adds later degrades to the same fallback the global
  // filter uses for any uncoded HttpException.
  return { code: `HTTP_${status}`, message, params: {} };
}

/**
 * Better Auth's OAuth callback reports failure by redirecting to the error URL
 * the SPA gave it, with `?error=<snake_case>` and an English
 * `error_description`. These are the values a seller can cause; the rest are
 * misconfiguration or tampering, and read as one generic failure.
 */
const oauthRedirect: Readonly<Record<string, ErrorCode>> = {
  // Signing in with an untrusted provider (Facebook) whose email already has an account.
  account_not_linked: 'AUTH_ACCOUNT_NOT_LINKED',
  // The seller said no on the provider's consent screen.
  access_denied: 'AUTH_SOCIAL_CANCELLED',
  // Linking a provider account whose email isn't the signed-in seller's.
  email_does_not_match: 'AUTH_SOCIAL_EMAIL_MISMATCH',
  // Linking a provider account another seller already signs in with.
  account_already_linked_to_different_user: 'AUTH_SOCIAL_ACCOUNT_TAKEN',
};

/** Any origin works: it only lets a relative Location parse, and is dropped again. */
const RELATIVE_BASE = 'http://relative.invalid';

/**
 * The OAuth callback's redirect Location with its `error` rewritten to an
 * ErrorCode and `error_description` dropped, so the SPA reads it through
 * `errorCodeSchema` like every other redirect the API sends. Undefined when
 * the Location carries no error - a successful sign-in or link.
 */
export function toOAuthErrorLocation(location: string): string | undefined {
  const url = new URL(location, RELATIVE_BASE);
  const error = url.searchParams.get('error');
  if (error === null) {
    return undefined;
  }

  url.searchParams.set('error', oauthRedirect[error] ?? 'AUTH_SOCIAL_FAILED');
  url.searchParams.delete('error_description');

  return url.origin === RELATIVE_BASE ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
