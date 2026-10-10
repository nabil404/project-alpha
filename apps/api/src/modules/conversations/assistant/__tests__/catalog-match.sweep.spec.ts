import {
  decide,
  decideProduct,
  MATCH_THRESHOLDS,
  productScores,
  variantScores,
  type MatchThresholds,
} from '../catalog-match';
import { EVAL_CATALOG, PRODUCT_CASES, VARIANT_CASES, productByKey } from './fixtures/match-eval';
import { keyOf, productOutcome, same, variantOutcome } from './fixtures/match-score';

/**
 * Reruns the sweep MATCH_THRESHOLDS was tuned with: every combination below
 * over the eval set, one row each, best first, the shipped constants marked
 * `*`. A tool, not a check, so it runs only on request:
 * `MATCH_SWEEP=1 pnpm --filter api test catalog-match.sweep`.
 */
const GRID = {
  one: [0.35, 0.4, 0.45, 0.5, 0.55, 0.6],
  lead: [0.05, 0.1, 0.15, 0.2, 0.25],
  some: [0.2, 0.25, 0.3, 0.35, 0.4],
  word: [0.3, 0.35, 0.4, 0.45, 0.5],
};

interface Row {
  t: MatchThresholds;
  products: number;
  variants: number;
  wrong: string[];
  misses: string[];
}

type Scored = { id: string; score: number }[];

const asVariant = (picked: ReturnType<typeof decide>) =>
  picked === null
    ? ({ kind: 'none' } as const)
    : typeof picked === 'string'
      ? ({ kind: 'one', variantId: picked } as const)
      : ({ kind: 'some', variantIds: picked } as const);

/** Scores depend only on `word`; the other three only decide among them, so each word's scores are computed once. */
function evaluate(t: MatchThresholds, products: Scored[], variants: Scored[]): Row {
  const misses: string[] = [];
  const wrong: string[] = [];
  PRODUCT_CASES.forEach((entry, index) => {
    const match = decideProduct(products[index]!, entry.queries, EVAL_CATALOG, t);
    if (!same(productOutcome(match), entry.expected)) misses.push(entry.message);
    if (match.kind === 'one' && keyOf(match.productId) !== entry.expected)
      wrong.push(entry.message);
  });
  const variantHits = VARIANT_CASES.filter((entry, index) =>
    same(variantOutcome(entry.product, asVariant(decide(variants[index]!, t))), entry.expected),
  ).length;
  return {
    t,
    products: (PRODUCT_CASES.length - misses.length) / PRODUCT_CASES.length,
    variants: variantHits / VARIANT_CASES.length,
    wrong,
    misses,
  };
}

const isShipped = (t: MatchThresholds) =>
  (Object.keys(MATCH_THRESHOLDS) as (keyof MatchThresholds)[]).every(
    (key) => t[key] === MATCH_THRESHOLDS[key],
  );

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`.padStart(8);

(process.env.MATCH_SWEEP === '1' ? describe : describe.skip)(
  'catalog match threshold sweep',
  () => {
    it('prints every combination over the eval set', () => {
      const rows: Row[] = [];
      for (const word of GRID.word) {
        const scoring = { ...MATCH_THRESHOLDS, word };
        const products = PRODUCT_CASES.map((entry) =>
          productScores(entry.queries, EVAL_CATALOG, scoring),
        );
        const variants = VARIANT_CASES.map((entry) =>
          variantScores(entry.queries, productByKey(entry.product), scoring),
        );
        for (const one of GRID.one)
          for (const lead of GRID.lead)
            for (const some of GRID.some)
              rows.push(evaluate({ one, lead, some, word }, products, variants));
      }
      rows.sort(
        (a, b) =>
          a.wrong.length - b.wrong.length ||
          b.products - a.products ||
          b.variants - a.variants ||
          a.t.one - b.t.one ||
          a.t.lead - b.t.lead ||
          a.t.some - b.t.some ||
          a.t.word - b.t.word,
      );
      const shipped = rows.find((row) => isShipped(row.t));
      const line = (row: Row) =>
        [
          isShipped(row.t) ? '*' : ' ',
          [row.t.one, row.t.lead, row.t.some, row.t.word].map((v) => v.toFixed(2)).join('  '),
          pct(row.products),
          pct(row.variants),
          String(row.wrong.length).padStart(5),
          String(row.misses.length).padStart(6),
          ' ' + (row.wrong.length ? `wrong: ${row.wrong.join(', ')}` : row.misses.join(', ')),
        ].join(' ');
      const header = '  one   lead  some  word  products variants wrong misses  detail';
      process.stdout.write(
        [
          '',
          `match threshold sweep: ${rows.length} combinations over ${PRODUCT_CASES.length} product and ${VARIANT_CASES.length} variant cases`,
          'sorted by confident-wrong count, then identification; `*` is MATCH_THRESHOLDS',
          header,
          ...rows.map(line),
          '',
          'shipped:',
          header,
          shipped ? line(shipped) : '  (MATCH_THRESHOLDS is off the grid)',
          '',
        ].join('\n'),
      );
      expect(shipped).toBeDefined();
    });
  },
);
