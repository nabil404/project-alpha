import { matchProduct, matchVariant } from '../catalog-match';
import { EVAL_CATALOG, PRODUCT_CASES, VARIANT_CASES, productByKey } from './fixtures/match-eval';
import { keyOf, productOutcome, score, variantOutcome } from './fixtures/match-score';

/** The success metric: the matcher identifies the product (or says none) for at least this share. */
const TARGET = 0.9;

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
