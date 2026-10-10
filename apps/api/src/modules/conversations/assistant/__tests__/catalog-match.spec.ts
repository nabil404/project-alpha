import {
  matchArea,
  matchProduct,
  matchVariant,
  normalize,
  similarity,
  type DeliveryArea,
} from '../catalog-match';
import { EVAL_CATALOG, productByKey } from './fixtures/match-eval';

const id = (key: string) => productByKey(key).id;
const variantNamed = (key: string, name: string) =>
  productByKey(key).variants.find((variant) => variant.name === name)!.id;

describe('normalize and similarity', () => {
  it('folds case, punctuation and Bangla digits', () => {
    expect(normalize('  Three-Piece, ৩ টা!! ')).toBe('three piece 3 টা');
  });

  it("computes pg_trgm's similarity", () => {
    // The value Postgres documents for similarity('word', 'two words').
    expect(similarity('word', 'two words')).toBeCloseTo(0.363636, 5);
    expect(similarity('kurti', 'kurti')).toBe(1);
    expect(similarity('kurti', 'lungi')).toBe(0);
  });
});

describe('matchProduct', () => {
  it.each([
    ['the exact name', ['Matte Lipstick'], 'lipstick'],
    ['an alias', ['scarf'], 'hijab'],
    ['a misspelling and its transliteration', ['jamdane sharee', 'জামদানে শারি'], 'jamdani'],
    ['Banglish', ['punjabi ta'], 'panjabi'],
    ['Bangla script', ['পাঞ্জাবি'], 'panjabi'],
    ['the other-script form when the first misses', ['xyz', 'বোরকা'], 'abaya'],
    ['a product word with a variant word', ['black panjabi'], 'panjabi'],
  ])('finds %s', (_label, queries, key) => {
    expect(matchProduct(queries, EVAL_CATALOG)).toEqual({ kind: 'one', productId: id(key) });
  });

  it('offers the close candidates when no one product wins', () => {
    expect(matchProduct(['saree'], EVAL_CATALOG)).toEqual({
      kind: 'some',
      productIds: expect.arrayContaining([id('jamdani'), id('katan')]),
    });
  });

  it('offers at most three candidates', () => {
    const many = {
      products: ['Red Saree', 'Blue Saree', 'Green Saree', 'Pink Saree'].map((name, n) => ({
        ...productByKey('lungi'),
        id: `00000000-0000-4000-8999-00000000000${n}`,
        name,
        aliases: [],
      })),
    };
    const match = matchProduct(['saree'], many);
    expect(match.kind).toBe('some');
    expect(match.kind === 'some' && match.productIds).toHaveLength(3);
  });

  it('offers the winner beside a product whose own word the customer also wrote', () => {
    expect(matchProduct(['not katan, jamdani'], EVAL_CATALOG)).toEqual({
      kind: 'some',
      productIds: [id('katan'), id('jamdani')],
    });
  });

  it('keeps a clear winner when only one script lands on another product word', () => {
    expect(matchProduct(['কাতান শাড়ি', 'katan shari'], EVAL_CATALOG)).toEqual({
      kind: 'one',
      productId: id('katan'),
    });
  });

  it('finds nothing for what the shop does not sell, or for no words', () => {
    expect(matchProduct(['iphone 15', 'আইফোন ১৫'], EVAL_CATALOG)).toEqual({ kind: 'none' });
    expect(matchProduct([undefined, '  '], EVAL_CATALOG)).toEqual({ kind: 'none' });
  });

  it('matches only the products it is given', () => {
    const withoutLungi = {
      products: EVAL_CATALOG.products.filter((product) => product.id !== id('lungi')),
    };
    expect(matchProduct(['lungi'], withoutLungi)).toEqual({ kind: 'none' });
  });
});

describe('matchVariant', () => {
  it('needs every value of a variant for a clear match', () => {
    expect(matchVariant(['black 42'], productByKey('panjabi'))).toEqual({
      kind: 'one',
      variantId: variantNamed('panjabi', '42 / Black'),
    });
  });

  it('offers the variants one value fits', () => {
    const match = matchVariant(['white'], productByKey('panjabi'));
    expect(match).toEqual({
      kind: 'some',
      variantIds: expect.arrayContaining([
        variantNamed('panjabi', '38 / White'),
        variantNamed('panjabi', '40 / White'),
        variantNamed('panjabi', '42 / White'),
      ]),
    });
  });

  it('matches an out-of-stock variant, so the reply can say so', () => {
    const outOfStock = variantNamed('panjabi', '42 / Black');
    expect(productByKey('panjabi').variants.find((v) => v.id === outOfStock)?.stock).toBe(0);
    expect(matchVariant(['42 black'], productByKey('panjabi'))).toEqual({
      kind: 'one',
      variantId: outOfStock,
    });
  });

  it('reads a size written in words and Bangla digits', () => {
    expect(matchVariant(['৩-৪ বছর'], productByKey('frock'))).toEqual({
      kind: 'one',
      variantId: variantNamed('frock', '3-4Y'),
    });
  });

  it('finds nothing for a value the product lacks', () => {
    expect(matchVariant(['sobuj', 'সবুজ'], productByKey('jamdani'))).toEqual({ kind: 'none' });
  });
});

describe('matchArea', () => {
  const area = (n: number, areaName: string | null): DeliveryArea => ({
    id: `00000000-0000-4000-8000-0000000000a${n}`,
    areaName,
    charge: 6000 + n,
  });
  const dhaka = area(1, 'Dhaka');
  const mirpur = area(2, 'Mirpur');
  const ctg = area(3, 'Chattogram');
  const elsewhere = area(9, null);
  const areas = [dhaka, mirpur, ctg];

  it('takes the area the customer named, misspelt or not', () => {
    expect(matchArea('Chattagram', 'House 4, Road 2', areas, elsewhere)).toBe(ctg);
    expect(matchArea('mirpur', undefined, areas, elsewhere)).toBe(mirpur);
  });

  it('finds an area named in the address, in the seller order', () => {
    expect(matchArea(undefined, 'House 12, Mirpur 10, Dhaka', areas, elsewhere)).toBe(dhaka);
  });

  it('falls back to everywhere else, or null when the shop has none', () => {
    expect(matchArea('Sylhet', 'Zindabazar, Sylhet', areas, elsewhere)).toBe(elsewhere);
    expect(matchArea(undefined, 'Zindabazar, Sylhet', areas, null)).toBeNull();
  });
});
