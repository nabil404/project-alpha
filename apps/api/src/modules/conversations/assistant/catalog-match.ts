import { toLatinDigits, type Product, type Variant } from '@app/shared';

/** The sellable catalog as the assistant sees it: active products, live variants. */
export interface CatalogView {
  products: Product[];
}

export type ProductMatch =
  { kind: 'one'; productId: string } | { kind: 'some'; productIds: string[] } | { kind: 'none' };

export type VariantMatch =
  { kind: 'one'; variantId: string } | { kind: 'some'; variantIds: string[] } | { kind: 'none' };

/** One of the shop's delivery rows: a named area, or the everywhere-else fallback. */
export interface DeliveryArea {
  id: string;
  /** Null for the everywhere-else row. */
  areaName: string | null;
  charge: number;
}

export interface MatchThresholds {
  /** A clear winner scores at least this... */
  one: number;
  /** ...and leads the runner-up by this much. */
  lead: number;
  /** Below this a candidate is not offered at all. */
  some: number;
  /** Two words this similar (pg_trgm) are the same word misspelt: "kurthi", "kurti". */
  word: number;
}

/**
 * Tuned by sweeping the eval set (__tests__/fixtures/match-eval.ts). `one` is
 * the lowest value at which no case names a wrong product as the clear
 * winner; at 0.4 "face cream" became Sunscreen.
 */
export const MATCH_THRESHOLDS: MatchThresholds = { one: 0.45, lead: 0.15, some: 0.3, word: 0.4 };

/** Candidates offered when there is no clear winner. */
export const MAX_CANDIDATES = 3;

/** NFKC, lowercase, Latin digits, punctuation to spaces. Letters keep their marks (Bangla vowel signs). */
export function normalize(text: string): string {
  return toLatinDigits(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function wordsOf(text: string): string[] {
  const normalized = normalize(text);
  return normalized === '' ? [] : normalized.split(' ');
}

/** pg_trgm's trigrams of each word: padded with two spaces before and one after. */
function trigrams(words: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const word of words) {
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i += 1) set.add(chars.slice(i, i + 3).join(''));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** pg_trgm's `similarity()`: shared trigrams over all trigrams of the two texts' words. */
export function similarity(a: string, b: string): number {
  return jaccard(trigrams(wordsOf(a)), trigrams(wordsOf(b)));
}

/**
 * How strongly `word` appears among `among`: 1 for the same word, the
 * similarity of a misspelling at least `word` alike, 1 for a size like "4y"
 * written as its number alone ("4 years" names "3-4Y"), else 0.
 */
function strength(word: string, among: readonly string[], t: MatchThresholds): number {
  let top = 0;
  for (const candidate of among) {
    if (word === candidate) return 1;
    if (/^\d+\p{L}+$/u.test(word) && word.replace(/\p{L}+$/u, '') === candidate) return 1;
    const similar = jaccard(trigrams([word]), trigrams([candidate]));
    if (similar >= t.word) top = Math.max(top, similar);
  }
  return top;
}

function coverage(words: readonly string[], among: readonly string[], t: MatchThresholds): number {
  return words.reduce((sum, word) => sum + strength(word, among, t), 0) / words.length;
}

/**
 * How well a customer's words name a catalog text. An exact match, or every
 * word of one inside the other, scores 1. Otherwise the better of pg_trgm's
 * similarity and how much of the name the customer wrote times how much of
 * what they wrote is the name, each word allowed a misspelling.
 */
function nameScore(query: readonly string[], name: string, t: MatchThresholds): number {
  const words = wordsOf(name);
  if (query.length === 0 || words.length === 0) return 0;
  const inQuery = new Set(query);
  const inName = new Set(words);
  if (query.every((word) => inName.has(word)) || words.every((word) => inQuery.has(word))) return 1;
  return Math.max(
    jaccard(trigrams(query), trigrams(words)),
    coverage(words, query, t) * coverage(query, words, t),
  );
}

function best(
  queries: readonly (readonly string[])[],
  names: readonly string[],
  t: MatchThresholds,
): number {
  let top = 0;
  for (const query of queries) {
    for (const name of names) top = Math.max(top, nameScore(query, name, t));
  }
  return top;
}

/** `one` for a clear winner, up to three candidates when it is close, nothing below the floor. */
function decide(
  scored: { id: string; score: number }[],
  t: MatchThresholds,
): string[] | string | null {
  const ranked = scored.filter((entry) => entry.score >= t.some).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first) return null;
  if (first.score >= t.one && (!second || first.score - second.score >= t.lead)) return first.id;
  return ranked.slice(0, MAX_CANDIDATES).map((entry) => entry.id);
}

function forms(queries: readonly (string | undefined)[]): string[][] {
  return queries
    .map((query) => (query === undefined ? [] : wordsOf(query)))
    .filter((words) => words.length > 0);
}

/**
 * The query without the words that name one of the product's own option
 * values: "red jamdani" is the Jamdani asked for in red. Unchanged when that
 * would leave nothing.
 */
function withoutValueWords(
  query: readonly string[],
  product: Product,
  t: MatchThresholds,
): readonly string[] {
  const values = product.options.flatMap((option) =>
    option.values.flatMap((value) => wordsOf(value.value)),
  );
  if (values.length === 0) return query;
  const rest = query.filter((word) => strength(word, values, t) === 0);
  return rest.length > 0 ? rest : query;
}

/** Scores each product by its name and aliases against every form of the customer's words. */
export function matchProduct(
  queries: readonly (string | undefined)[],
  catalog: CatalogView,
  t: MatchThresholds = MATCH_THRESHOLDS,
): ProductMatch {
  const written = forms(queries);
  if (written.length === 0) return { kind: 'none' };
  const result = decide(
    catalog.products.map((product) => ({
      id: product.id,
      score: best(
        written.map((query) => withoutValueWords(query, product, t)),
        [product.name, ...product.aliases],
        t,
      ),
    })),
    t,
  );
  if (result === null) return { kind: 'none' };
  return typeof result === 'string'
    ? { kind: 'one', productId: result }
    : { kind: 'some', productIds: result };
}

/** A variant's option values ("40", "White"), or its own name's parts when it has none. */
export function variantValues(product: Product, variant: Variant): string[] {
  const values = new Map(
    product.options.flatMap((option) => option.values.map((value) => [value.id, value.value])),
  );
  const own = variant.optionValueIds.flatMap((id) => {
    const value = values.get(id);
    return value === undefined ? [] : [value];
  });
  if (own.length > 0) return own;
  return variant.name === null ? [] : variant.name.split('/').map((part) => part.trim());
}

/** The share of the variant's values the customer named, or its name's score if higher. */
function variantScore(
  written: readonly (readonly string[])[],
  product: Product,
  variant: Variant,
  t: MatchThresholds,
): number {
  const values = variantValues(product, variant).map(wordsOf);
  let top = variant.name === null ? 0 : best(written, [variant.name], t);
  if (values.length === 0) return top;
  for (const query of written) {
    const named = values.filter(
      (parts) => parts.length > 0 && parts.every((part) => strength(part, query, t) > 0),
    ).length;
    top = Math.max(top, named / values.length);
  }
  return top;
}

/**
 * Matches the customer's words for a variant ("black 42") against the
 * product's live variants. An out-of-stock variant can match, so the
 * assistant can say it is out; offering it is the caller's call.
 */
export function matchVariant(
  queries: readonly (string | undefined)[],
  product: Product,
  t: MatchThresholds = MATCH_THRESHOLDS,
): VariantMatch {
  const written = forms(queries);
  if (written.length === 0) return { kind: 'none' };
  const result = decide(
    product.variants.map((variant) => ({
      id: variant.id,
      score: variantScore(written, product, variant, t),
    })),
    t,
  );
  if (result === null) return { kind: 'none' };
  return typeof result === 'string'
    ? { kind: 'one', variantId: result }
    : { kind: 'some', variantIds: result };
}

/**
 * The shop's delivery row for an address: the area the customer named, else
 * an area named inside the address, else the everywhere-else row (null when
 * the shop never saved one). Ties go to the seller's order.
 */
export function matchArea(
  area: string | undefined,
  address: string | undefined,
  areas: readonly DeliveryArea[],
  fallback: DeliveryArea | null,
): DeliveryArea | null {
  const named = areas.flatMap((row) =>
    row.areaName === null ? [] : [{ row, words: wordsOf(row.areaName) }],
  );
  if (area !== undefined) {
    const query = wordsOf(area);
    let top: { row: DeliveryArea; score: number } | null = null;
    for (const entry of named) {
      const score = nameScore(query, entry.row.areaName!, MATCH_THRESHOLDS);
      if (score >= MATCH_THRESHOLDS.one && (!top || score > top.score))
        top = { row: entry.row, score };
    }
    if (top) return top.row;
  }
  if (address !== undefined) {
    const words = wordsOf(address);
    const inside = named.find((entry) => entry.words.length > 0 && containsRun(words, entry.words));
    if (inside) return inside.row;
  }
  return fallback;
}

/** Whether `run` appears in `words` as consecutive whole words. */
function containsRun(words: readonly string[], run: readonly string[]): boolean {
  for (let i = 0; i + run.length <= words.length; i += 1) {
    if (run.every((word, j) => words[i + j] === word)) return true;
  }
  return false;
}
