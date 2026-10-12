import { createProductSchema } from '@app/shared';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '../seed-catalog';
import { fillerNumber, fillerProducts } from '../seed-filler';
import { refuseUnlessLocal } from '../seed-guard';

const asInput = (seed: (typeof SEED_PRODUCTS)[number]) => ({
  name: seed.name,
  status: seed.status,
  aliases: seed.aliases,
  options: seed.options.map((o) => ({
    name: o.name,
    values: o.values.map((value) => ({ value })),
  })),
  variants: seed.variants,
});

describe('seed catalog', () => {
  it('passes the product schema the API enforces, product by product', () => {
    for (const seed of SEED_PRODUCTS) {
      const result = createProductSchema.safeParse(asInput(seed));
      expect({ name: seed.name, issues: result.error?.issues ?? [] }).toEqual({
        name: seed.name,
        issues: [],
      });
    }
  });

  it('files every product under one of the seeded categories, and names none twice', () => {
    expect(SEED_PRODUCTS.filter((p) => !SEED_CATEGORIES.includes(p.category))).toEqual([]);
    const names = SEED_PRODUCTS.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('fillerProducts', () => {
  it('is the same for the same arguments, and passes the product schema', () => {
    expect(fillerProducts(50)).toEqual(fillerProducts(50));
    for (const seed of fillerProducts(50)) {
      expect(createProductSchema.safeParse(asInput(seed)).success).toBe(true);
    }
  });

  it('numbers after the given offset, so a later run continues the sequence', () => {
    expect(fillerProducts(3, 7).map((p) => fillerNumber(p.name))).toEqual([8, 9, 10]);
  });

  it('never ends a hand-written name with a filler number', () => {
    expect(SEED_PRODUCTS.map((p) => fillerNumber(p.name))).toEqual(SEED_PRODUCTS.map(() => null));
  });
});

describe('refuseUnlessLocal', () => {
  it('allows development against a local database', () => {
    expect(refuseUnlessLocal('development', 'postgres://u:p@localhost:5432/app')).toBeNull();
    expect(refuseUnlessLocal('development', 'postgres://u:p@127.0.0.1/app')).toBeNull();
  });

  it('refuses any other environment, or a remote database', () => {
    expect(refuseUnlessLocal('production', 'postgres://u:p@localhost/app')).toMatch(/NODE_ENV/);
    expect(refuseUnlessLocal('development', 'postgres://u:p@db.example.com/app')).toMatch(
      /db\.example\.com/,
    );
  });
});
