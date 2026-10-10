import type { ExtractedItem, OrderItemSlot } from '@app/shared';
import { mergeItems, mergeSameVariant } from '../item-merge';

const SAREE = '00000000-0000-4000-8000-0000000000a1';
const SAREE_RED = '00000000-0000-4000-8000-0000000000b1';
const KAJAL = '00000000-0000-4000-8000-0000000000a2';
const KAJAL_ONLY = '00000000-0000-4000-8000-0000000000b2';

const said = (overrides: Partial<ExtractedItem>): ExtractedItem => ({
  ref: null,
  productQuery: null,
  productQueryAlt: null,
  variantQuery: null,
  variantQueryAlt: null,
  quantity: null,
  ...overrides,
});

const collected: OrderItemSlot[] = [
  {
    productQuery: 'red saree',
    productQueryAlt: 'রেড শাড়ি',
    variantQuery: 'red',
    productId: SAREE,
    variantId: SAREE_RED,
    quantity: 1,
  },
  { productQuery: 'kajal', productId: KAJAL, variantId: KAJAL_ONLY, quantity: 2 },
];

describe('mergeItems', () => {
  it('leaves the items alone when extraction said nothing about them', () => {
    expect(mergeItems(collected, null)).toEqual({
      items: collected,
      origins: [0, 1],
      refs: [0, 1],
    });
  });

  it('turns two products in one message into two new items', () => {
    const { items, origins } = mergeItems(
      [],
      [
        said({ productQuery: 'red saree', productQueryAlt: 'রেড শাড়ি', quantity: 2 }),
        said({ productQuery: 'kajal' }),
      ],
    );
    expect(items).toEqual([
      { productQuery: 'red saree', productQueryAlt: 'রেড শাড়ি', quantity: 2 },
      { productQuery: 'kajal' },
    ]);
    expect(origins).toEqual([null, null]);
  });

  it('changes only the quantity of the item a ref names, keeping its matched ids', () => {
    const { items, origins } = mergeItems(collected, [
      said({ ref: 0 }),
      said({ ref: 1, quantity: 3 }),
    ]);
    expect(items).toEqual([collected[0], { ...collected[1], quantity: 3 }]);
    expect(origins).toEqual([0, 1]);
  });

  it.each([
    ['its own words', 'red saree'],
    ['its own words recased', '  RED SAREE '],
    ['its catalog name', 'Red Silk Saree'],
  ])('matches an item again when its product words come back as %s', (_label, productQuery) => {
    const { items, origins, refs } = mergeItems(collected, [
      said({ ref: 0, productQuery, quantity: 3 }),
    ]);
    expect(items).toEqual([{ productQuery: productQuery.trim(), quantity: 3 }]);
    expect(origins).toEqual([null]);
    expect(refs).toEqual([0]);
  });

  it('matches the variant again when its words come back, even unchanged', () => {
    const { items, origins } = mergeItems(collected, [said({ ref: 0, variantQuery: 'red' })]);
    expect(items).toEqual([
      {
        productQuery: 'red saree',
        productQueryAlt: 'রেড শাড়ি',
        variantQuery: 'red',
        productId: SAREE,
        quantity: 1,
      },
    ]);
    expect(origins).toEqual([0]);
  });

  it('removes an item the returned list leaves out', () => {
    const { items, origins } = mergeItems(collected, [said({ ref: 1 })]);
    expect(items).toEqual([collected[1]]);
    expect(origins).toEqual([1]);
  });

  it('clears the ids of an item whose product words changed, keeping its quantity', () => {
    const { items, origins, refs } = mergeItems(collected, [
      said({ ref: 0, productQuery: 'blue jamdani', productQueryAlt: 'ব্লু জামদানি' }),
    ]);
    expect(items).toEqual([
      { productQuery: 'blue jamdani', productQueryAlt: 'ব্লু জামদানি', quantity: 1 },
    ]);
    expect(origins).toEqual([null]);
    expect(refs).toEqual([0]);
  });

  it('clears only the variant when only the variant words changed', () => {
    const { items } = mergeItems(collected, [
      said({ ref: 0, variantQuery: 'maroon', variantQueryAlt: 'মেরুন' }),
    ]);
    expect(items).toEqual([
      {
        productQuery: 'red saree',
        productQueryAlt: 'রেড শাড়ি',
        variantQuery: 'maroon',
        variantQueryAlt: 'মেরুন',
        productId: SAREE,
        quantity: 1,
      },
    ]);
  });

  it('treats a ref that does not exist, or one already used, as a new item', () => {
    const { items, origins } = mergeItems(collected, [
      said({ ref: 0 }),
      said({ ref: 0, productQuery: 'lungi' }),
      said({ ref: 7, productQuery: 'hijab' }),
    ]);
    expect(items).toEqual([collected[0], { productQuery: 'lungi' }, { productQuery: 'hijab' }]);
    expect(origins).toEqual([0, null, null]);
  });

  it('drops an entry with no product words and nothing to continue', () => {
    expect(mergeItems([], [said({ quantity: 2 })]).items).toEqual([]);
  });
});

describe('mergeSameVariant', () => {
  it('merges items on the same variant into the first, summing quantities', () => {
    const { items, moved } = mergeSameVariant([
      { productId: SAREE, variantId: SAREE_RED, quantity: 1 },
      { productId: KAJAL, variantId: KAJAL_ONLY, quantity: 2 },
      { productId: SAREE, variantId: SAREE_RED, quantity: 2 },
    ]);
    expect(items).toEqual([
      { productId: SAREE, variantId: SAREE_RED, quantity: 3 },
      { productId: KAJAL, variantId: KAJAL_ONLY, quantity: 2 },
    ]);
    expect(moved).toEqual([0, 1, 0]);
  });

  it('keeps a quantity that only one of the two had, and never merges unresolved items', () => {
    const { items } = mergeSameVariant([
      { productId: SAREE, variantId: SAREE_RED },
      { productQuery: 'saree' },
      { productId: SAREE, variantId: SAREE_RED, quantity: 2 },
      { productQuery: 'saree' },
    ]);
    expect(items).toEqual([
      { productId: SAREE, variantId: SAREE_RED, quantity: 2 },
      { productQuery: 'saree' },
      { productQuery: 'saree' },
    ]);
  });
});
