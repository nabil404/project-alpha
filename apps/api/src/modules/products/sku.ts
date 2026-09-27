import { randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a SKU read aloud or retyped survives. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Trimmed and upper-cased, so uniqueness ignores case. Blank means "generate one". */
export function normalizeSku(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/** 40 random bits; the repository retries on the rare collision. */
export function generateSku(): string {
  let body = '';
  for (let i = 0; i < 8; i++) {
    body += CROCKFORD[randomInt(CROCKFORD.length)];
  }
  return `SKU-${body}`;
}
