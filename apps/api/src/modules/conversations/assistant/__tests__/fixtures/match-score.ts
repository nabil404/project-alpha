import type { ProductMatch, VariantMatch } from '../../catalog-match';
import { EVAL_PRODUCTS, productByKey } from './match-eval';

/** A match as the eval set writes its expectation: a product key, `none`, or the candidates offered. */
export type Outcome = string | { some: string[] };

export const keyOf = (id: string) => EVAL_PRODUCTS.find((product) => product.id === id)?.key ?? id;

export function productOutcome(match: ProductMatch): Outcome {
  if (match.kind === 'one') return keyOf(match.productId);
  if (match.kind === 'some') return { some: match.productIds.map(keyOf).sort() };
  return 'none';
}

export function variantOutcome(product: string, match: VariantMatch): Outcome {
  const nameOf = (id: string) =>
    productByKey(product).variants.find((variant) => variant.id === id)?.name ?? id;
  if (match.kind === 'one') return nameOf(match.variantId);
  if (match.kind === 'some') return { some: match.variantIds.map(nameOf).sort() };
  return 'none';
}

const canonical = (outcome: Outcome) =>
  JSON.stringify(typeof outcome === 'string' ? outcome : { some: [...outcome.some].sort() });

export const same = (a: Outcome, b: Outcome) => canonical(a) === canonical(b);

/** The share of cases whose outcome is the expected one, and a line per miss. */
export function score<T extends { queries: string[]; expected: Outcome }>(
  cases: readonly T[],
  outcome: (entry: T) => Outcome,
  label: (entry: T) => string,
) {
  const misses = cases.flatMap((entry) => {
    const got = outcome(entry);
    return same(got, entry.expected)
      ? []
      : [`${label(entry)}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(got)}`];
  });
  return { rate: (cases.length - misses.length) / cases.length, misses };
}
