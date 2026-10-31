import {
  MAX_POST_PRODUCTS,
  minorUnitsPerMajor,
  PRODUCT_OPTION_MAX_COUNT,
  PRODUCT_OPTION_VALUE_MAX_COUNT,
  PRODUCT_VARIANT_MAX_COUNT,
  toMinorUnits,
  type CreateProduct,
  type NotProductResult,
  type PostProduct,
  type PostProducts,
} from '@app/shared';

/**
 * From what the LLM read in a post to the drafts the import may write. The
 * LLM only parses: everything here is checked against the catalog's limits
 * and the shop's categories before it becomes a product.
 */

/** A product a post gave, checked and ready to write as a draft. */
export interface PostDraft {
  /** Draft status, no stock, no SKU (one is generated): what the product writer takes. */
  document: CreateProduct;
  /** A category name the shop does not have, offered to the seller only. */
  suggestedCategory: string | null;
}

export type CheckedPost =
  | {
      kind: 'not_product';
      result: Extract<NotProductResult, 'not_a_product' | 'no_named_product'>;
      /** The reader's own words for what the post is, when it gave any. */
      note: string | null;
    }
  | {
      kind: 'products';
      drafts: PostDraft[];
      /** Something was cut to fit the catalog's limits: the seller should look. */
      flagged: boolean;
    };

export interface DraftContext {
  currency: string;
  /** The shop's live categories. */
  categories: readonly { id: string; name: string }[];
}

const NAME_MAX = 200;
const DESCRIPTION_MAX = 5000;
const OPTION_TEXT_MAX = 40;
const ALIASES_MAX = 10;

const same = (text: string) => text.trim().toLowerCase();

export function checkPostProducts(output: PostProducts, context: DraftContext): CheckedPost {
  if (output.kind === 'not_product') {
    return { kind: 'not_product', result: 'not_a_product', note: output.reason?.trim() || null };
  }
  let flagged = output.products.length > MAX_POST_PRODUCTS;
  const drafts: PostDraft[] = [];
  for (const product of output.products.slice(0, MAX_POST_PRODUCTS)) {
    const checked = draftOf(product, context);
    if (!checked) continue;
    flagged ||= checked.flagged;
    drafts.push(checked.draft);
  }
  // The reader said products, but none had a name that passed the checks.
  if (drafts.length === 0) return { kind: 'not_product', result: 'no_named_product', note: null };
  return { kind: 'products', drafts, flagged };
}

function draftOf(
  product: PostProduct,
  context: DraftContext,
): { draft: PostDraft; flagged: boolean } | null {
  const name = product.name.trim().slice(0, NAME_MAX);
  if (!name) return null;

  const { options, flagged } = fitOptions(product.options);
  const combinations = combine(options.map((option) => option.values));
  const prices = (product.prices ?? []).flatMap((row) => {
    const price = minorPrice(row.price, context.currency);
    return price === null ? [] : [{ values: row.values.map(same).filter(Boolean), price }];
  });

  const category = categoryOf(product.category, context.categories);
  return {
    flagged,
    draft: {
      document: {
        name,
        description: product.description?.trim().slice(0, DESCRIPTION_MAX) || null,
        status: 'draft',
        aliases: aliasesOf(product.aliases, name),
        customDelivery: false,
        deliveryCharges: [],
        categoryIds: category.categoryId ? [category.categoryId] : [],
        options: options.map((option) => ({
          name: option.name,
          values: option.values.map((value) => ({ value })),
        })),
        variants: combinations.map((optionValues) => ({
          optionValues,
          price: priceFor(optionValues, prices),
          stock: null,
          imageId: null,
        })),
      },
      suggestedCategory: category.suggested,
    },
  };
}

/** At most three options of at most thirty values, and at most a hundred variants between them. */
function fitOptions(raw: PostProduct['options']): {
  options: { name: string; values: string[] }[];
  flagged: boolean;
} {
  let flagged = false;
  const options: { name: string; values: string[] }[] = [];
  for (const option of raw) {
    const name = option.name.trim().slice(0, OPTION_TEXT_MAX);
    const seen = new Set<string>();
    const values = option.values
      .map((value) => value.trim().slice(0, OPTION_TEXT_MAX))
      .filter((value) => value && !seen.has(same(value)) && seen.add(same(value)));
    if (!name || values.length === 0 || options.some((kept) => same(kept.name) === same(name))) {
      continue;
    }
    if (values.length > PRODUCT_OPTION_VALUE_MAX_COUNT) flagged = true;
    options.push({ name, values: values.slice(0, PRODUCT_OPTION_VALUE_MAX_COUNT) });
  }
  if (options.length > PRODUCT_OPTION_MAX_COUNT) flagged = true;
  const kept = options.slice(0, PRODUCT_OPTION_MAX_COUNT);
  // Drop the last option's last values until the combinations fit.
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    while (variantCount(kept) > PRODUCT_VARIANT_MAX_COUNT && kept[index]!.values.length > 1) {
      kept[index]!.values.pop();
      flagged = true;
    }
  }
  return { options: kept, flagged };
}

const variantCount = (options: readonly { values: readonly string[] }[]) =>
  options.reduce((count, option) => count * option.values.length, 1);

/** Every combination of one value per option, in option order; one empty one with no options. */
function combine(values: readonly (readonly string[])[]): string[][] {
  return values.reduce<string[][]>(
    (rows, option) => rows.flatMap((row) => option.map((value) => [...row, value])),
    [[]],
  );
}

/** A positive, finite major-unit price in minor units, else null. */
function minorPrice(major: number, currency: string): number | null {
  if (!Number.isFinite(major) || major <= 0) return null;
  const minor = toMinorUnits(major, minorUnitsPerMajor(currency));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 2_147_483_647 ? minor : null;
}

/**
 * The price of the most specific row whose every value is one of the
 * variant's: a row with no values prices every variant, "M" prices each M.
 */
function priceFor(
  optionValues: readonly string[],
  prices: readonly { values: string[]; price: number }[],
): number | null {
  const own = new Set(optionValues.map(same));
  let best: { values: string[]; price: number } | null = null;
  for (const row of prices) {
    if (!row.values.every((value) => own.has(value))) continue;
    if (!best || row.values.length > best.values.length) best = row;
  }
  return best?.price ?? null;
}

function aliasesOf(raw: readonly string[], name: string): string[] {
  const seen = new Set([same(name)]);
  const aliases: string[] = [];
  for (const alias of raw) {
    const text = alias.trim().slice(0, NAME_MAX);
    if (!text || seen.has(same(text))) continue;
    seen.add(same(text));
    aliases.push(text);
  }
  return aliases.slice(0, ALIASES_MAX);
}

/**
 * An existing category the LLM named is linked; a name the shop does not
 * have is only suggested. A "suggested" name that is in fact one of the
 * shop's is linked too.
 */
function categoryOf(
  raw: PostProduct['category'],
  categories: readonly { id: string; name: string }[],
): { categoryId: string | null; suggested: string | null } {
  const name = raw?.name.trim();
  if (!raw || !name) return { categoryId: null, suggested: null };
  const found = categories.find((category) => same(category.name) === same(name));
  if (found) return { categoryId: found.id, suggested: null };
  return { categoryId: null, suggested: raw.kind === 'suggested' ? name.slice(0, 80) : null };
}
