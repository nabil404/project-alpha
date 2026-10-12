/**
 * The dev seed's hand-written catalog: a Dhaka clothing and lifestyle shop,
 * prices in paisa. Between them the products cover what the dashboard and the
 * assistant have to handle: single variants, one to three options, sold-out
 * variants, Banglish aliases, drafts, an archived product and per-product
 * delivery charges.
 */

export interface SeedOption {
  name: string;
  values: string[];
}

export interface SeedVariant {
  optionValues: string[];
  price: number;
  stock: number;
}

export interface SeedProduct {
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  aliases: string[];
  category: string;
  /** Added to each of the shop's delivery charges as the product's own; unset uses the shop's. */
  deliverySurcharge?: number;
  options: SeedOption[];
  variants: SeedVariant[];
}

export const SEED_CATEGORIES = [
  "Women's Clothing",
  "Men's Clothing",
  'Footwear',
  'Accessories',
  'Home & Living',
];

export const taka = (amount: number) => amount * 100;

/** The options, and a variant for every combination of their values. */
export function varied(
  options: SeedOption[],
  price: (values: string[]) => number,
  stock: (values: string[]) => number,
): Pick<SeedProduct, 'options' | 'variants'> {
  const combos = options.reduce<string[][]>(
    (acc, option) => acc.flatMap((combo) => option.values.map((value) => [...combo, value])),
    [[]],
  );
  return {
    options,
    variants: combos.map((values) => ({
      optionValues: values,
      price: price(values),
      stock: stock(values),
    })),
  };
}

export const single = (
  price: number,
  stock: number,
): Pick<SeedProduct, 'options' | 'variants'> => ({
  options: [],
  variants: [{ optionValues: [], price, stock }],
});

const size = (...values: string[]) => ({ name: 'Size', values });
const colour = (...values: string[]) => ({ name: 'Colour', values });

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Cotton Panjabi',
    description: 'Soft cotton panjabi with a straight cut, for everyday and Friday prayers.',
    status: 'active',
    aliases: ['panjabi', 'punjabi', 'cotton punjabi'],
    category: "Men's Clothing",
    ...varied(
      [size('S', 'M', 'L', 'XL'), colour('White', 'Navy', 'Maroon')],
      ([s]) => (s === 'XL' ? taka(1650) : taka(1550)),
      ([s, c]) => (s === 'S' && c === 'Maroon' ? 0 : 8),
    ),
  },
  {
    name: 'Eid Silk Panjabi',
    description: 'Half-silk panjabi with an embroidered placket.',
    status: 'active',
    aliases: ['silk panjabi', 'eid panjabi'],
    category: "Men's Clothing",
    ...varied(
      [size('S', 'M', 'L', 'XL')],
      () => taka(3200),
      ([s]) => (s === 'L' ? 0 : 4),
    ),
  },
  {
    name: 'Printed Kurti',
    description: 'Block-printed cotton kurti, knee length.',
    status: 'active',
    aliases: ['kurti', 'kurta', 'printed kurta'],
    category: "Women's Clothing",
    ...varied(
      [size('S', 'M', 'L'), colour('Mustard', 'Teal')],
      () => taka(1250),
      ([s]) => (s === 'M' ? 12 : 5),
    ),
  },
  {
    name: 'Three-Piece Salwar Kameez',
    description: 'Unstitched three-piece: kameez, salwar and dupatta.',
    status: 'active',
    aliases: ['three piece', '3 piece', 'thri pis', 'salwar kameez'],
    category: "Women's Clothing",
    ...varied(
      [colour('Rose', 'Sky Blue', 'Olive', 'Black')],
      () => taka(2450),
      ([c]) => (c === 'Black' ? 0 : 6),
    ),
  },
  {
    name: 'Jamdani Saree',
    description: 'Handwoven Dhakai jamdani, with a blouse piece.',
    status: 'active',
    aliases: ['jamdani', 'saree', 'sari', 'dhakai jamdani'],
    category: "Women's Clothing",
    deliverySurcharge: taka(60),
    ...varied(
      [colour('Red', 'Off-White', 'Green')],
      ([c]) => (c === 'Red' ? taka(9500) : taka(8800)),
      () => 2,
    ),
  },
  {
    name: 'Cotton Lungi',
    description: 'Check-pattern cotton lungi, pre-stitched.',
    status: 'active',
    aliases: ['lungi', 'checked lungi'],
    category: "Men's Clothing",
    ...single(taka(450), 30),
  },
  {
    name: 'Polo Shirt',
    description: 'Pique cotton polo.',
    status: 'active',
    aliases: ['polo', 'polo t-shirt', 'tshirt'],
    category: "Men's Clothing",
    ...varied(
      [
        size('S', 'M', 'L', 'XL'),
        colour('Black', 'White', 'Bottle Green'),
        { name: 'Fit', values: ['Regular', 'Slim'] },
      ],
      ([, , fit]) => (fit === 'Slim' ? taka(890) : taka(850)),
      ([s, , fit]) => (s === 'XL' && fit === 'Slim' ? 0 : 3),
    ),
  },
  {
    name: 'Denim Jeans',
    description: 'Stretch denim, mid rise.',
    status: 'active',
    aliases: ['jeans', 'jins', 'denim pant'],
    category: "Men's Clothing",
    ...varied(
      [{ name: 'Waist', values: ['30', '32', '34', '36'] }],
      () => taka(1800),
      ([w]) => (w === '36' ? 1 : 7),
    ),
  },
  {
    name: 'Leather Sandal',
    description: 'Handmade leather sandal with a cushioned sole.',
    status: 'active',
    aliases: ['sandal', 'chappal', 'leather chappal'],
    category: 'Footwear',
    ...varied(
      [size('40', '41', '42', '43', '44')],
      () => taka(1450),
      ([s]) => (s === '44' ? 0 : 5),
    ),
  },
  {
    name: 'Ladies Nagra',
    description: 'Embroidered nagra shoe.',
    status: 'active',
    aliases: ['nagra', 'nagra juta'],
    category: 'Footwear',
    ...varied(
      [size('36', '37', '38', '39'), colour('Gold', 'Silver')],
      () => taka(1100),
      () => 4,
    ),
  },
  {
    name: 'Rubber Slipper',
    description: null,
    status: 'active',
    aliases: ['slipper', 'sandel', 'bathroom slipper'],
    category: 'Footwear',
    ...single(taka(220), 0),
  },
  {
    name: 'Cotton Hijab',
    description: 'Breathable jersey hijab.',
    status: 'active',
    aliases: ['hijab', 'scarf', 'orna'],
    category: 'Accessories',
    ...varied(
      [colour('Black', 'Beige', 'Dusty Pink', 'Navy', 'Grey')],
      () => taka(350),
      ([c]) => (c === 'Black' ? 25 : 10),
    ),
  },
  {
    name: 'Leather Wallet',
    description: 'Bi-fold wallet, genuine leather.',
    status: 'active',
    aliases: ['wallet', 'manibag', 'money bag'],
    category: 'Accessories',
    ...varied(
      [colour('Brown', 'Black')],
      () => taka(650),
      () => 9,
    ),
  },
  {
    name: 'Prayer Tupi',
    description: 'Knitted cotton prayer cap.',
    status: 'active',
    aliases: ['tupi', 'topi', 'prayer cap'],
    category: 'Accessories',
    ...single(taka(150), 40),
  },
  {
    name: 'Nakshi Kantha Bedsheet',
    description: 'Hand-stitched nakshi kantha, king size, with two pillow covers.',
    status: 'active',
    aliases: ['nakshi kantha', 'kantha', 'bedsheet', 'bed cover'],
    category: 'Home & Living',
    deliverySurcharge: taka(80),
    ...single(taka(4200), 3),
  },
  {
    name: 'Clay Water Pot',
    description: 'Terracotta kolshi, about five litres. Fragile.',
    status: 'active',
    aliases: ['kolshi', 'matir kolshi', 'clay pot'],
    category: 'Home & Living',
    deliverySurcharge: taka(120),
    ...single(taka(550), 6),
  },
  {
    name: 'Jute Table Mat Set',
    description: 'Set of six handwoven jute mats.',
    status: 'active',
    aliases: ['table mat', 'jute mat'],
    category: 'Home & Living',
    ...single(taka(480), 14),
  },
  {
    name: 'Kids Frock',
    description: 'Cotton party frock with a net layer.',
    status: 'draft',
    aliases: ['frock', 'baby frock'],
    category: "Women's Clothing",
    ...varied(
      [{ name: 'Age', values: ['2-3 years', '4-5 years', '6-7 years'] }],
      () => taka(950),
      () => 5,
    ),
  },
  {
    name: 'Winter Shawl',
    description: 'Wool-blend shawl, arriving in November.',
    status: 'draft',
    aliases: ['shawl', 'chador'],
    category: 'Accessories',
    ...single(taka(1350), 0),
  },
  {
    name: 'Fatua (Old Stock)',
    description: 'Short cotton fatua. Discontinued.',
    status: 'archived',
    aliases: ['fatua', 'fotua'],
    category: "Men's Clothing",
    ...varied(
      [size('M', 'L')],
      () => taka(600),
      () => 2,
    ),
  },
];
