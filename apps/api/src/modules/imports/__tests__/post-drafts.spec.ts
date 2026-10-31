import {
  createProductSchema,
  PRODUCT_OPTION_VALUE_MAX_COUNT,
  PRODUCT_VARIANT_MAX_COUNT,
  type PostProduct,
  type PostProducts,
} from '@app/shared';
import { checkPostProducts } from '../post-drafts';

const SAREES = { id: '6f0c1d64-3c0e-4f43-9d8c-6a3f6f1f2a10', name: 'Sarees' };
const context = { currency: 'BDT', categories: [SAREES] };

const product = (overrides: Partial<PostProduct> = {}): PostProduct => ({
  name: 'জামদানি শাড়ি',
  description: null,
  aliases: [],
  options: [],
  prices: null,
  category: null,
  ...overrides,
});

const products = (...items: PostProduct[]): PostProducts => ({
  kind: 'products',
  reason: null,
  products: items,
});

function draftsOf(output: PostProducts) {
  const checked = checkPostProducts(output, context);
  if (checked.kind !== 'products') throw new Error(`expected products, got ${checked.result}`);
  return checked;
}

describe('checkPostProducts', () => {
  it("keeps the reader's words on a not-product post as its note", () => {
    const notProduct = (reason: string | null) =>
      checkPostProducts({ kind: 'not_product', reason, products: [] }, context);
    expect(notProduct('Eid greeting')).toEqual({
      kind: 'not_product',
      result: 'not_a_product',
      note: 'Eid greeting',
    });
    expect(notProduct('  ')).toEqual({ kind: 'not_product', result: 'not_a_product', note: null });
    expect(notProduct(null)).toEqual({ kind: 'not_product', result: 'not_a_product', note: null });
  });

  it('keeps the name as written and writes a valid draft with no stock or SKU', () => {
    const { drafts, flagged } = draftsOf(
      products(product({ prices: [{ values: [], price: 1250 }] })),
    );
    expect(flagged).toBe(false);
    const doc = drafts[0]!.document;
    expect(doc).toMatchObject({ name: 'জামদানি শাড়ি', status: 'draft' });
    expect(doc.variants).toEqual([
      { optionValues: [], price: 125_000, stock: null, imageId: null },
    ]);
    expect(createProductSchema.safeParse(doc).success).toBe(true);
  });

  it('keeps aliases in both scripts, dropping blanks, repeats and the name itself', () => {
    const { drafts } = draftsOf(
      products(
        product({ aliases: ['jamdani saree', 'Jamdani Saree', ' ', 'জামদানি শাড়ি', 'Jamdani'] }),
      ),
    );
    expect(drafts[0]!.document.aliases).toEqual(['jamdani saree', 'Jamdani']);
  });

  it('prices each variant from the most specific row, and leaves an unpriced one empty', () => {
    const { drafts } = draftsOf(
      products(
        product({
          options: [
            { name: 'Size', values: ['M', 'L', 'XL'] },
            { name: 'Colour', values: ['Red', 'Blue'] },
          ],
          prices: [
            { values: ['M'], price: 900 },
            { values: ['L'], price: 950 },
            { values: ['l', 'blue'], price: 990 },
          ],
        }),
      ),
    );
    const price = (size: string, colour: string) =>
      drafts[0]!.document.variants.find(
        (variant) => variant.optionValues.join('/') === `${size}/${colour}`,
      )!.price;
    expect(drafts[0]!.document.variants).toHaveLength(6);
    expect(price('M', 'Red')).toBe(90_000);
    expect(price('L', 'Red')).toBe(95_000);
    expect(price('L', 'Blue')).toBe(99_000);
    expect(price('XL', 'Red')).toBeNull();
  });

  it('reads a price written on a photo the same as one in the caption', () => {
    // The LLM reports both the same way; code only sees the number.
    const { drafts } = draftsOf(products(product({ prices: [{ values: [], price: 2450.5 }] })));
    expect(drafts[0]!.document.variants[0]!.price).toBe(245_050);
  });

  it('drops a price that is not a positive number', () => {
    const { drafts } = draftsOf(
      products(
        product({
          prices: [
            { values: [], price: 0 },
            { values: [], price: -5 },
            { values: [], price: Number.NaN },
          ],
        }),
      ),
    );
    expect(drafts[0]!.document.variants[0]!.price).toBeNull();
  });

  it('cuts options to the catalog limits and flags the post', () => {
    const many = Array.from({ length: 40 }, (_, index) => `V${index}`);
    const checked = draftsOf(
      products(
        product({
          options: [
            { name: 'A', values: many },
            { name: 'B', values: ['1', '2', '3', '4', '5'] },
            { name: 'C', values: ['x', 'y'] },
            { name: 'D', values: ['p'] },
          ],
        }),
      ),
    );
    const doc = checked.drafts[0]!.document;
    expect(checked.flagged).toBe(true);
    expect(doc.options.map((option) => option.name)).toEqual(['A', 'B', 'C']);
    expect(doc.options[0]!.values.length).toBeLessThanOrEqual(PRODUCT_OPTION_VALUE_MAX_COUNT);
    expect(doc.variants.length).toBeLessThanOrEqual(PRODUCT_VARIANT_MAX_COUNT);
    expect(createProductSchema.safeParse(doc).success).toBe(true);
  });

  it('drops repeated and empty option values', () => {
    const { drafts } = draftsOf(
      products(product({ options: [{ name: 'Size', values: ['M', 'm', ' ', 'L'] }] })),
    );
    expect(drafts[0]!.document.options[0]!.values).toEqual([{ value: 'M' }, { value: 'L' }]);
  });

  it('links an existing category, drops an unknown one, and keeps a suggestion apart', () => {
    const { drafts } = draftsOf(
      products(
        product({ name: 'A', category: { kind: 'existing', name: 'sarees' } }),
        product({ name: 'B', category: { kind: 'existing', name: 'Shoes' } }),
        product({ name: 'C', category: { kind: 'suggested', name: 'Three piece' } }),
      ),
    );
    expect(drafts.map((draft) => draft.document.categoryIds)).toEqual([[SAREES.id], [], []]);
    expect(drafts.map((draft) => draft.suggestedCategory)).toEqual([null, null, 'Three piece']);
  });

  it('drops a product with no name, and reads a post left with none as not a product', () => {
    expect(draftsOf(products(product({ name: ' ' }), product())).drafts).toHaveLength(1);
    expect(checkPostProducts(products(product({ name: '' })), context)).toEqual({
      kind: 'not_product',
      result: 'no_named_product',
      note: null,
    });
  });
});
