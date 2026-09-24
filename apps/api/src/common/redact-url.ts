/**
 * Request URLs are logged on every request, and some carry a credential:
 *   - /api/webhooks/messenger?hub.verify_token=...  Meta's subscription check
 *   - /api/auth/verify-email?token=...              the email verification link
 *   - /api/auth/reset-password/<token>?...          the reset link
 *   - /api/auth/callback/<provider>?code=...        an OAuth authorization code
 *
 * Each is a secret or a bearer credential until used, so it is masked before
 * the URL reaches pino. Everything else in the URL stays readable.
 *
 * Better Auth answers /api/auth/* before Nest's middleware runs, so pino-http
 * does not log those requests today. They are covered anyway: the day request
 * logging moves in front of the auth handler, it must not start leaking links.
 */
const SENSITIVE_PARAMS: ReadonlySet<string> = new Set([
  'token',
  'code',
  'state',
  'hub.verify_token',
]);
const RESET_PATH = /(\/reset-password\/)[^/?#]+/;
const MASK = '[REDACTED]';

export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart + 1);

  const safePath = path.replace(RESET_PATH, `$1${MASK}`);
  if (!query) {
    return queryStart === -1 ? safePath : `${safePath}?`;
  }

  const safeQuery = query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      const key = separator === -1 ? pair : pair.slice(0, separator);
      return separator !== -1 && SENSITIVE_PARAMS.has(decodeKey(key)) ? `${key}=${MASK}` : pair;
    })
    .join('&');

  return `${safePath}?${safeQuery}`;
}

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}
