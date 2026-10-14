import {
  matchArea,
  matchProduct,
  matchVariant,
  normalize,
  similarity,
  type DeliveryArea,
} from '../catalog-match';
import type { Product } from '@app/shared';
import { EVAL_CATALOG, EVAL_PRODUCTS, productByKey } from './fixtures/match-eval';

/** Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps. */
function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const d = x.map(() => new Array<number>(y.length + 1).fill(0));
  d.push(new Array<number>(y.length + 1).fill(0));
  for (let i = 0; i <= x.length; i += 1) d[i]![0] = i;
  for (let j = 0; j <= y.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= x.length; i += 1)
    for (let j = 1; j <= y.length; j += 1) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[x.length]![y.length]!;
}

const withinEdits = (a: string, b: string) => editDistance(a, b) <= 1;

const id = (key: string) => productByKey(key).id;
const productById = (productId: string) => EVAL_PRODUCTS.find((p) => p.id === productId)!;
const own = (product: Product) =>
  [product.name, ...product.aliases].flatMap((text) => normalize(text).split(' '));
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
      categories: [],
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

  it.each([
    [['katan na jamdni dao']],
    [['katan na, jamdni']],
    [['কাতান না জামদানী', 'katan na jamdani']],
    [['katan na kuti']],
  ])(
    'asks rather than pick the winner when another product is misspelt beside it: %j',
    (queries) => {
      const match = matchProduct(queries, EVAL_CATALOG);
      expect(match.kind).toBe('some');
      expect(match.kind === 'some' && match.productIds).toContain(id('katan'));
    },
  );

  describe('a garbled word naming another product', () => {
    const kurtiSet = {
      products: [
        productByKey('kurti'),
        {
          ...productByKey('lungi'),
          id: '00000000-0000-4000-8999-000000000009',
          name: 'Kurti Set',
          aliases: [],
        },
      ],
      categories: [],
    };

    it.each([
      ['a rival with a swap and a dropped letter', ['katan jmadni'], EVAL_CATALOG],
      ['the same in both scripts', ['katan jmadni', 'কাতান জমাদনি'], EVAL_CATALOG],
      ['a rival with two letters swapped', ['kurti lugni'], EVAL_CATALOG],
      ['a one-letter slip in a short word', ['kurti sat'], kurtiSet],
    ])('asks rather than pick the winner: %s', (_label, queries, catalog) => {
      expect(matchProduct(queries, catalog).kind).toBe('some');
    });

    const filler = (char: string) => (/\p{Script=Bengali}/u.test(char) ? 'ঝ' : 'q');
    const garbles = (word: string) => {
      const chars = Array.from(word);
      const edit = (i: number, drop: number, ...insert: string[]) =>
        [...chars.slice(0, i), ...insert, ...chars.slice(i + drop)].join('');
      const out = chars.flatMap((char, i) => [
        edit(i, 1),
        edit(i, 0, filler(char)),
        edit(i, 1, filler(char)),
        ...(i + 1 < chars.length ? [edit(i, 2, chars[i + 1]!, char)] : []),
      ]);
      return out.filter((garbled) => garbled !== word && Array.from(garbled).length >= 3);
    };

    it("never keeps A clear when B's own word is written one edit off", () => {
      const owner = new Map<string, string>();
      for (const b of EVAL_PRODUCTS)
        for (const word of new Set(own(b)))
          for (const garbled of garbles(word)) owner.set(garbled, b.id);
      const kept: string[] = [];
      for (const a of EVAL_PRODUCTS) {
        const mine = own(a);
        for (const [garbled, b] of owner) {
          if (b === a.id || mine.some((ownWord) => withinEdits(garbled, ownWord))) continue;
          const match = matchProduct([`${a.name} ${garbled}`], EVAL_CATALOG);
          if (match.kind === 'one' && match.productId === a.id) kept.push(`${a.name} + ${garbled}`);
        }
      }
      expect(kept).toEqual([]);
    });
  });

  describe('a typo as near to two products', () => {
    it.each([[['kajan']], [['kajan', 'কাজন']], [['katal']]])(
      'offers both rather than pick one: %j',
      (queries) => {
        const match = matchProduct(queries, EVAL_CATALOG);
        expect(match.kind).toBe('some');
        expect(match.kind === 'some' && match.productIds).toEqual(
          expect.arrayContaining([id('katan'), id('kajal')]),
        );
      },
    );

    const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
    const typos = (word: string) => {
      const out = new Set<string>();
      for (let i = 0; i <= word.length; i += 1) {
        const [head, tail] = [word.slice(0, i), word.slice(i)];
        for (const letter of LETTERS) out.add(head + letter + tail);
        if (i === word.length) continue;
        out.add(head + tail.slice(1));
        for (const letter of LETTERS) out.add(head + letter + tail.slice(1));
        if (i + 1 < word.length) out.add(head + tail[1] + tail[0] + tail.slice(2));
      }
      out.delete(word);
      return out;
    };

    it('never names a product other than the one a Latin word was typed for', () => {
      const ownWords = new Set(EVAL_PRODUCTS.flatMap(own));
      const queries: { source: string; forms: string[] }[] = [];
      for (const product of EVAL_PRODUCTS) {
        const bangla = product.aliases.filter((alias) => /\p{Script=Bengali}/u.test(alias));
        const latin = new Set(own(product).filter((word) => /^[a-z]+$/.test(word)));
        for (const word of latin)
          for (const typo of typos(word)) {
            if (ownWords.has(typo)) continue;
            queries.push({ source: product.id, forms: [typo] });
            for (const form of bangla) queries.push({ source: product.id, forms: [typo, form] });
          }
      }
      const wrong = queries.flatMap(({ source, forms }) => {
        const match = matchProduct(forms, EVAL_CATALOG);
        return match.kind === 'one' && match.productId !== source
          ? [`${forms.join(' | ')} -> ${productById(match.productId).name}`]
          : [];
      });
      expect(wrong).toEqual([]);
      expect(queries.length).toBeGreaterThan(25_000);
    });
  });

  it.each([[['কাতান শাড়ি', 'katan shari']], [['শার্ট', 'shart']]])(
    'keeps a clear winner whose other-script twin is its own word: %j',
    (queries) => {
      expect(matchProduct(queries, EVAL_CATALOG).kind).toBe('one');
    },
  );

  it('finds nothing for what the shop does not sell, or for no words', () => {
    expect(matchProduct(['iphone 15', 'আইফোন ১৫'], EVAL_CATALOG)).toEqual({ kind: 'none' });
    expect(matchProduct([undefined, '  '], EVAL_CATALOG)).toEqual({ kind: 'none' });
  });

  it('matches only the products it is given', () => {
    const withoutLungi = {
      products: EVAL_CATALOG.products.filter((product) => product.id !== id('lungi')),
      categories: [],
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
