import { matchProduct, matchVariant, type ProductMatch, type VariantMatch } from '../catalog-match';
import {
  EVAL_CATALOG,
  EVAL_PRODUCTS,
  PRODUCT_CASES,
  VARIANT_CASES,
  productByKey,
} from './fixtures/match-eval';

/** The success metric: the matcher identifies the product (or says none) for at least this share. */
const TARGET = 0.9;

const keyOf = (id: string) => EVAL_PRODUCTS.find((product) => product.id === id)?.key ?? id;

function productOutcome(match: ProductMatch): string | { some: string[] } {
  if (match.kind === 'one') return keyOf(match.productId);
  if (match.kind === 'some') return { some: match.productIds.map(keyOf).sort() };
  return 'none';
}

function variantOutcome(product: string, match: VariantMatch): string | { some: string[] } {
  const nameOf = (id: string) =>
    productByKey(product).variants.find((variant) => variant.id === id)?.name ?? id;
  if (match.kind === 'one') return nameOf(match.variantId);
  if (match.kind === 'some') return { some: match.variantIds.map(nameOf).sort() };
  return 'none';
}

const same = (a: string | { some: string[] }, b: string | { some: string[] }) =>
  JSON.stringify(typeof a === 'string' ? a : { some: [...a.some].sort() }) ===
  JSON.stringify(typeof b === 'string' ? b : { some: [...b.some].sort() });

function score<T extends { queries: string[]; expected: string | { some: string[] } }>(
  cases: T[],
  outcome: (entry: T) => string | { some: string[] },
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

describe('catalog matching eval set', () => {
  it('holds at least 60 cases', () => {
    expect(PRODUCT_CASES.length + VARIANT_CASES.length).toBeGreaterThanOrEqual(60);
  });

  it(`identifies the product for at least ${TARGET * 100}% of messages`, () => {
    const { rate, misses } = score(
      PRODUCT_CASES,
      (entry) => productOutcome(matchProduct(entry.queries, EVAL_CATALOG)),
      (entry) => entry.message,
    );
    console.warn(
      `product match: ${(rate * 100).toFixed(1)}% of ${PRODUCT_CASES.length}${misses.length ? `\n  ${misses.join('\n  ')}` : ''}`,
    );
    expect(rate).toBeGreaterThanOrEqual(TARGET);
  });

  it('never names a wrong product as the clear winner', () => {
    const wrong = PRODUCT_CASES.flatMap((entry) => {
      const match = matchProduct(entry.queries, EVAL_CATALOG);
      return match.kind === 'one' && keyOf(match.productId) !== entry.expected
        ? [entry.message]
        : [];
    });
    expect(wrong).toEqual([]);
  });

  it(`identifies the variant for at least ${TARGET * 100}% of variant words`, () => {
    const { rate, misses } = score(
      VARIANT_CASES,
      (entry) =>
        variantOutcome(entry.product, matchVariant(entry.queries, productByKey(entry.product))),
      (entry) => `${entry.product} "${entry.queries[0]}"`,
    );
    console.warn(
      `variant match: ${(rate * 100).toFixed(1)}% of ${VARIANT_CASES.length}${misses.length ? `\n  ${misses.join('\n  ')}` : ''}`,
    );
    expect(rate).toBeGreaterThanOrEqual(TARGET);
  });
});
