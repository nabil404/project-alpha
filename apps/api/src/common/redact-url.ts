/**
 * Masks credentials in logged request URLs:
 *   - /api/v1/webhooks/messenger?hub.verify_token=...  Meta's subscription check
 *   - /api/v1/auth/verify-email?token=...              email verification link
 *   - /api/v1/auth/reset-password/<token>?...          reset link
 *   - /api/v1/auth/callback/<provider>?code=...        OAuth authorization code
 *   - /api/v1/conversations?q=...                      a customer name or message text
 *
 * Better Auth answers /api/v1/auth/* before pino-http runs, so those are not
 * logged today. They stay masked in case logging moves in front of it.
 */
const SENSITIVE_PARAMS: ReadonlySet<string> = new Set([
  'token',
  'code',
  'state',
  'hub.verify_token',
  'q',
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
