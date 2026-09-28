import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CryptoService } from '../../../common/crypto.service';

/**
 * The Page connection flow spans three requests - start, Facebook's callback,
 * and the seller picking a Page - so its state rides in one short-lived
 * cookie, encrypted with CryptoService (AES-256-GCM): tamper-proof, and
 * unreadable to the browser holding it.
 *
 *   authorizing - after start: the OAuth `state` nonce the callback must echo.
 *   authorized  - after the callback: the seller's long-lived user token,
 *                 read again when listing and connecting Pages.
 *
 * It is bound to the seller and shop that started it, so a cookie from another
 * session is ignored rather than trusted.
 */
export const PAGE_CONNECT_COOKIE = 'page_connect';

/** Long enough to pick a Page, short enough that a user token doesn't linger in a browser. */
export const PAGE_CONNECT_TTL_MS = 15 * 60 * 1000;

const identitySchema = z.object({
  userId: z.string().min(1),
  merchantId: z.string().min(1),
  expiresAt: z.number().int(),
});

const flowSchema = z.discriminatedUnion('stage', [
  identitySchema.extend({ stage: z.literal('authorizing'), state: z.string().min(1) }),
  identitySchema.extend({ stage: z.literal('authorized'), userToken: z.string().min(1) }),
]);

export type PageConnectFlow = z.infer<typeof flowSchema>;

export interface FlowOwner {
  userId: string;
  merchantId: string;
}

type Cipher = Pick<CryptoService, 'encrypt' | 'decrypt'>;

export function newOAuthState(): string {
  return randomBytes(24).toString('base64url');
}

export function sealFlow(cipher: Cipher, flow: PageConnectFlow): string {
  return cipher.encrypt(JSON.stringify(flow));
}

/**
 * The flow in `sealed`, or null if it is absent, tampered with, expired, or
 * belongs to another seller or shop. Every one of those means "start again".
 */
export function openFlow(
  cipher: Cipher,
  sealed: string | undefined,
  owner: FlowOwner,
  now = Date.now(),
): PageConnectFlow | null {
  if (!sealed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cipher.decrypt(sealed));
  } catch {
    return null;
  }

  const flow = flowSchema.safeParse(parsed);
  if (!flow.success) return null;
  if (flow.data.expiresAt <= now) return null;
  if (flow.data.userId !== owner.userId || flow.data.merchantId !== owner.merchantId) return null;
  return flow.data;
}

/** Constant-time: the state is a secret the callback has to prove it knows. */
export function stateMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One cookie's value out of a Cookie header; no parser middleware is mounted. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
