import { SEED_CATEGORIES, single, taka, varied, type SeedProduct } from './seed-catalog';

const ADJECTIVES = ['Classic', 'Everyday', 'Premium', 'Handloom', 'Festive', 'Casual', 'Slim'];
const MATERIALS = ['Cotton', 'Linen', 'Khadi', 'Silk', 'Denim', 'Jute', 'Leather'];
const ITEMS = ['Shirt', 'Kurti', 'Panjabi', 'Scarf', 'Bag', 'Cushion Cover', 'Belt', 'Tote'];

/** mulberry32: small, fast, and the same sequence for the same seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The number a filler name ends with, or null for any other name. */
export function fillerNumber(name: string): number | null {
  const match = /#(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * `count` generated products for volume, numbered after `after`, so a second
 * run continues the sequence and none matches a hand-written name. Mostly a
 * single variant, about one in five sold in sizes, about one in ten a draft.
 * The same arguments always yield the same products.
 */
export function fillerProducts(count: number, after = 0): SeedProduct[] {
  const random = prng(after + 1);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

  return Array.from({ length: count }, (_, i) => {
    const price = taka(150 + Math.floor(random() * 60) * 50);
    const stock = random() < 0.15 ? 0 : 1 + Math.floor(random() * 30);
    const sized = random() < 0.2;
    return {
      name: `${pick(ADJECTIVES)} ${pick(MATERIALS)} ${pick(ITEMS)} #${after + i + 1}`,
      description: null,
      status: random() < 0.1 ? 'draft' : 'active',
      aliases: [],
      category: pick(SEED_CATEGORIES),
      ...(sized
        ? varied(
            [{ name: 'Size', values: ['S', 'M', 'L'] }],
            () => price,
            () => stock,
          )
        : single(price, stock)),
    };
  });
}
