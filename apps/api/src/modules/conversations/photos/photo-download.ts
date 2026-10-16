import type { PhotoFailure } from '../message-content';

/** Meta's attachment CDNs, the only hosts a customer's photo is fetched from (SSRF). */
const PHOTO_HOSTS = ['fbcdn.net', 'fbsbx.com'] as const;
const MAX_REDIRECTS = 3;

export interface DownloadLimits {
  timeoutMs: number;
  maxBytes: number;
}

/** Messenger recompresses photos well under this; a screenshot of a long post can be larger. */
export const PHOTO_DOWNLOAD_LIMITS: DownloadLimits = {
  timeoutMs: 10_000,
  maxBytes: 10 * 1024 * 1024,
};

export type DownloadResult =
  | { ok: true; body: Buffer }
  | {
      ok: false;
      reason: Extract<PhotoFailure, 'timeout' | 'too_large' | 'not_allowed' | 'failed'>;
    };

/** The link as a URL when it is https on one of Meta's CDNs, with no credentials or port. */
export function photoUrl(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return PHOTO_HOSTS.some((root) => host === root || host.endsWith(`.${root}`)) ? url : null;
}

/**
 * Fetches a customer's photo from Meta, with one deadline for the whole
 * download and a byte cap checked while it streams, so a slow or huge file
 * never holds the worker. Redirects are followed by hand, each hop checked
 * against the same hosts. Never throws.
 */
export async function downloadPhoto(
  raw: string | null,
  limits: DownloadLimits = PHOTO_DOWNLOAD_LIMITS,
  fetcher: typeof fetch = fetch,
): Promise<DownloadResult> {
  let url = photoUrl(raw);
  if (!url) return { ok: false, reason: 'not_allowed' };
  const signal = AbortSignal.timeout(limits.timeoutMs);
  try {
    for (let hop = 0; ; hop += 1) {
      const response = await fetcher(url, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next = response.headers.get('location');
        url = next && hop < MAX_REDIRECTS ? photoUrl(new URL(next, url).href) : null;
        if (!url) return { ok: false, reason: 'not_allowed' };
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return { ok: false, reason: 'failed' };
      }
      const declared = Number(response.headers.get('content-length'));
      if (declared > limits.maxBytes) {
        await response.body.cancel();
        return { ok: false, reason: 'too_large' };
      }
      return await readCapped(response.body, limits.maxBytes);
    }
  } catch {
    return { ok: false, reason: signal.aborted ? 'timeout' : 'failed' };
  }
}

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<DownloadResult> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  return { ok: true, body: Buffer.concat(chunks) };
}
