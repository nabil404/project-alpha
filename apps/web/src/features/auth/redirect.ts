/**
 * A `?redirect=` value is only followed when it is a path on this origin.
 * Anything else - `https://evil.test`, `//evil.test`, `/\evil.test` - would
 * turn the sign-in page into an open redirect.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return undefined;
  }
  return value.startsWith('//') || value.startsWith('/\\') ? undefined : value;
}
