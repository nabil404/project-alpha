import BowserModule from 'bowser';

// bowser ships CommonJS marked __esModule: under Node's ESM loader the default
// import is the whole exports object, under the bundler it is the class.
const Bowser =
  (BowserModule as unknown as { default?: typeof BowserModule }).default ?? BowserModule;

/**
 * "Chrome" and "macOS" from a stored user agent, for the device list. Parsed
 * on the server so the raw string never reaches the page; null where bowser
 * can't tell.
 */
export function describeUserAgent(userAgent: string | null): {
  browser: string | null;
  os: string | null;
} {
  if (!userAgent) {
    return { browser: null, os: null };
  }
  const { browser, os } = Bowser.parse(userAgent);
  return { browser: browser.name || null, os: os.name || null };
}
