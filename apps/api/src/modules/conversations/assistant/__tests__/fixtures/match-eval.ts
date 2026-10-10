import type { Product } from '@app/shared';
import type { CatalogView } from '../../catalog-match';

/**
 * A catalog shaped like a small Bangladeshi clothing and cosmetics shop, and
 * what customers ask it for. Each case holds the customer's message and the
 * query forms extraction is expected to return for it: their words and the
 * same words in the other script. The matcher is scored on those forms; the
 * maintainer script runs the live extraction over the messages.
 */

const uuid = (prefix: number, n: number) =>
  `00000000-0000-4000-8${String(prefix).padStart(3, '0')}-${String(n).padStart(12, '0')}`;

interface OptionSpec {
  name: string;
  values: string[];
}

let nextProduct = 0;

function product(
  key: string,
  name: string,
  aliases: string[],
  options: OptionSpec[] = [],
  stock: (values: string[]) => number = () => 5,
): Product & { key: string } {
  const p = (nextProduct += 1);
  let nextValue = 0;
  const builtOptions = options.map((option, o) => ({
    id: uuid(200 + p, o),
    name: option.name,
    values: option.values.map((value) => ({ id: uuid(300 + p, (nextValue += 1)), value })),
  }));
  const combos: { values: string[]; ids: string[] }[] = builtOptions.reduce(
    (acc, option) =>
      acc.flatMap((combo) =>
        option.values.map((value) => ({
          values: [...combo.values, value.value],
          ids: [...combo.ids, value.id],
        })),
      ),
    [{ values: [] as string[], ids: [] as string[] }],
  );
  const variants = combos.map((combo, v) => {
    const units = stock(combo.values);
    return {
      id: uuid(100 + p, v),
      name: combo.values.length === 0 ? null : combo.values.join(' / '),
      sku: `${key}-${v}`,
      price: 100_000 + p * 10_000,
      stock: units,
      stockStatus: units > 0 ? ('in_stock' as const) : ('out_of_stock' as const),
      isDefault: combo.values.length === 0,
      imageId: null,
      optionValueIds: combo.ids,
    };
  });
  return {
    key,
    id: uuid(0, p),
    name,
    description: null,
    status: 'active',
    aliases,
    categoryIds: [],
    images: [],
    coverImageId: null,
    options: builtOptions,
    customDelivery: false,
    deliveryCharges: [],
    variants,
    version: '1',
  };
}

const COLOR = (...values: string[]) => ({ name: 'Color', values });
const SIZE = (...values: string[]) => ({ name: 'Size', values });

export const EVAL_PRODUCTS = [
  product(
    'jamdani',
    'Jamdani Saree',
    ['জামদানি শাড়ি', 'jamdani shari'],
    [COLOR('Red', 'Blue', 'Green')],
  ),
  product('katan', 'Katan Silk Saree', ['কাতান শাড়ি', 'katan'], [COLOR('Red', 'Maroon')]),
  product(
    'threepiece',
    'Cotton Three-Piece',
    ['থ্রি পিস', 'three piece', 'salwar kameez'],
    [SIZE('M', 'L', 'XL')],
  ),
  product(
    'panjabi',
    'Panjabi',
    ['পাঞ্জাবি', 'punjabi'],
    [SIZE('38', '40', '42'), COLOR('White', 'Black')],
    (values) => (values.join() === '42,Black' ? 0 : 4),
  ),
  product('kurti', 'Kurti', ['কুর্তি', 'kurta top'], [SIZE('S', 'M', 'L')]),
  product('lungi', 'Check Lungi', ['লুঙ্গি', 'lungi']),
  product('hijab', 'Georgette Hijab', ['হিজাব', 'scarf'], [COLOR('Black', 'Pink')]),
  product('abaya', 'Abaya', ['বোরকা', 'borka', 'burka']),
  product(
    'lipstick',
    'Matte Lipstick',
    ['লিপস্টিক', 'lip stick'],
    [{ name: 'Shade', values: ['Ruby Red', 'Nude', 'Pink'] }],
  ),
  product('facewash', 'Neem Face Wash', ['ফেসওয়াশ', 'facewash']),
  product('kajal', 'Kajal', ['কাজল', 'kohl', 'eyeliner']),
  product('sunscreen', 'Sunscreen SPF 50', ['সানস্ক্রিন', 'sun cream']),
  product('frock', 'Baby Frock', ['বেবি ফ্রক', 'frock'], [SIZE('1-2Y', '3-4Y')]),
  product('shirt', 'Formal Shirt', ['শার্ট', 'gents shirt'], [SIZE('M', 'L')]),
  product('kantha', 'Nakshi Kantha', ['নকশি কাঁথা', 'kantha']),
  product('rosewater', 'Rose Water', ['গোলাপ জল', 'golap jol']),
];

export const EVAL_CATALOG: CatalogView = { products: EVAL_PRODUCTS };

export type ProductKey = (typeof EVAL_PRODUCTS)[number]['key'];

export function productByKey(key: string): Product {
  const found = EVAL_PRODUCTS.find((p) => p.key === key);
  if (!found) throw new Error(`no eval product ${key}`);
  return found;
}

export interface ProductCase {
  message: string;
  /** What extraction should return: the customer's words, then the other script. */
  queries: string[];
  /** The one product meant, `none` for something the shop does not sell, or the candidates to offer. */
  expected: string | 'none' | { some: string[] };
}

export const PRODUCT_CASES: ProductCase[] = [
  // English and catalog names
  {
    message: 'Do you have Jamdani saree?',
    queries: ['Jamdani saree', 'জামদানি শাড়ি'],
    expected: 'jamdani',
  },
  {
    message: 'I want the katan silk saree',
    queries: ['katan silk saree', 'কাতান সিল্ক শাড়ি'],
    expected: 'katan',
  },
  { message: 'silk saree price?', queries: ['silk saree', 'সিল্ক শাড়ি'], expected: 'katan' },
  {
    message: 'cotton three piece available?',
    queries: ['cotton three piece', 'কটন থ্রি পিস'],
    expected: 'threepiece',
  },
  { message: 'I need a panjabi for Eid', queries: ['panjabi', 'পাঞ্জাবি'], expected: 'panjabi' },
  { message: 'kurti dekhan', queries: ['kurti', 'কুর্তি'], expected: 'kurti' },
  { message: 'one lungi please', queries: ['lungi', 'লুঙ্গি'], expected: 'lungi' },
  { message: 'georgette hijab', queries: ['georgette hijab', 'জর্জেট হিজাব'], expected: 'hijab' },
  { message: 'abaya ache?', queries: ['abaya', 'আবায়া'], expected: 'abaya' },
  {
    message: 'matte lipstick',
    queries: ['matte lipstick', 'ম্যাট লিপস্টিক'],
    expected: 'lipstick',
  },
  { message: 'neem face wash', queries: ['neem face wash', 'নিম ফেস ওয়াশ'], expected: 'facewash' },
  { message: 'kajal chai', queries: ['kajal', 'কাজল'], expected: 'kajal' },
  {
    message: 'sunscreen spf 50',
    queries: ['sunscreen spf 50', 'সানস্ক্রিন এসপিএফ ৫০'],
    expected: 'sunscreen',
  },
  {
    message: 'baby frock for my daughter',
    queries: ['baby frock', 'বেবি ফ্রক'],
    expected: 'frock',
  },
  { message: 'formal shirt', queries: ['formal shirt', 'ফরমাল শার্ট'], expected: 'shirt' },
  { message: 'nakshi kantha ase?', queries: ['nakshi kantha', 'নকশি কাঁথা'], expected: 'kantha' },
  { message: 'rose water', queries: ['rose water', 'রোজ ওয়াটার'], expected: 'rosewater' },
  // Bangla script
  {
    message: 'জামদানি শাড়িটা চাই',
    queries: ['জামদানি শাড়ি', 'jamdani shari'],
    expected: 'jamdani',
  },
  { message: 'কাতান শাড়ি আছে?', queries: ['কাতান শাড়ি', 'katan shari'], expected: 'katan' },
  { message: 'থ্রি পিস দেখান', queries: ['থ্রি পিস', 'three pis'], expected: 'threepiece' },
  { message: 'পাঞ্জাবি লাগবে', queries: ['পাঞ্জাবি', 'panjabi'], expected: 'panjabi' },
  { message: 'কুর্তি কত?', queries: ['কুর্তি', 'kurti'], expected: 'kurti' },
  { message: 'লুঙ্গি দুইটা', queries: ['লুঙ্গি', 'lungi'], expected: 'lungi' },
  { message: 'হিজাব আছে?', queries: ['হিজাব', 'hijab'], expected: 'hijab' },
  { message: 'একটা বোরকা দিন', queries: ['বোরকা', 'borka'], expected: 'abaya' },
  { message: 'লিপস্টিক নিব', queries: ['লিপস্টিক', 'lipstick'], expected: 'lipstick' },
  { message: 'ফেসওয়াশ টা দেন', queries: ['ফেসওয়াশ', 'facewash'], expected: 'facewash' },
  { message: 'কাজল আছে?', queries: ['কাজল', 'kajol'], expected: 'kajal' },
  { message: 'সানস্ক্রিন চাই', queries: ['সানস্ক্রিন', 'sunscreen'], expected: 'sunscreen' },
  { message: 'বাচ্চার ফ্রক', queries: ['ফ্রক', 'frok'], expected: 'frock' },
  { message: 'শার্ট টা কত', queries: ['শার্ট', 'shart'], expected: 'shirt' },
  { message: 'নকশী কাঁথা আছে?', queries: ['নকশী কাঁথা', 'nokshi katha'], expected: 'kantha' },
  { message: 'গোলাপ জল', queries: ['গোলাপ জল', 'golap jol'], expected: 'rosewater' },
  // Banglish and misspellings
  {
    message: 'jamdhani sari ase?',
    queries: ['jamdhani sari', 'জামধানি সারি'],
    expected: 'jamdani',
  },
  { message: 'kaatan sharee', queries: ['kaatan sharee', 'কাতান শাড়ি'], expected: 'katan' },
  { message: '3 piece ta koto', queries: ['3 piece', 'থ্রি পিস'], expected: 'threepiece' },
  { message: 'salwar kamiz', queries: ['salwar kamiz', 'সালোয়ার কামিজ'], expected: 'threepiece' },
  { message: 'punjabi ta niboh', queries: ['punjabi', 'পাঞ্জাবি'], expected: 'panjabi' },
  { message: 'panjabee', queries: ['panjabee', 'পাঞ্জাবী'], expected: 'panjabi' },
  { message: 'kurthi ache', queries: ['kurthi', 'কুর্তি'], expected: 'kurti' },
  { message: 'lunggi', queries: ['lunggi', 'লুঙ্গি'], expected: 'lungi' },
  { message: 'hijaab lagbe', queries: ['hijaab', 'হিজাব'], expected: 'hijab' },
  { message: 'burqa', queries: ['burqa', 'বুরকা'], expected: 'abaya' },
  { message: 'borkha chai', queries: ['borkha', 'বোরখা'], expected: 'abaya' },
  { message: 'lipstik', queries: ['lipstik', 'লিপস্টিক'], expected: 'lipstick' },
  { message: 'face wash ta', queries: ['face wash', 'ফেস ওয়াশ'], expected: 'facewash' },
  { message: 'kajol', queries: ['kajol', 'কাজল'], expected: 'kajal' },
  { message: 'sunskreen', queries: ['sunskreen', 'সানস্ক্রিন'], expected: 'sunscreen' },
  { message: 'frok', queries: ['frok', 'ফ্রক'], expected: 'frock' },
  { message: 'shart ta', queries: ['shart', 'শার্ট'], expected: 'shirt' },
  { message: 'nokshi katha', queries: ['nokshi katha', 'নকশি কাঁথা'], expected: 'kantha' },
  { message: 'golap jal', queries: ['golap jal', 'গোলাপ জল'], expected: 'rosewater' },
  { message: 'jamdane sharee', queries: ['jamdane sharee', 'জামদানে শারি'], expected: 'jamdani' },
  { message: 'panjebi ta', queries: ['panjebi', 'পানজেবি'], expected: 'panjabi' },
  { message: 'lipistic', queries: ['lipistic', 'লিপিস্টিক'], expected: 'lipstick' },
  { message: 'সানস্ক্রীন', queries: ['সানস্ক্রীন', 'sanskrin'], expected: 'sunscreen' },
  { message: 'kurtee', queries: ['kurtee', 'কুরতি'], expected: 'kurti' },
  { message: 'silk', queries: ['silk', 'সিল্ক'], expected: 'katan' },
  // Aliases
  { message: 'scarf ache?', queries: ['scarf', 'স্কার্ফ'], expected: 'hijab' },
  { message: 'eyeliner', queries: ['eyeliner', 'আইলাইনার'], expected: 'kajal' },
  { message: 'sun cream', queries: ['sun cream', 'সান ক্রিম'], expected: 'sunscreen' },
  { message: 'kurta top', queries: ['kurta top', 'কুর্তা টপ'], expected: 'kurti' },
  { message: 'gents shirt', queries: ['gents shirt', 'জেন্টস শার্ট'], expected: 'shirt' },
  { message: 'kohl', queries: ['kohl', 'কোহল'], expected: 'kajal' },
  { message: 'kantha', queries: ['kantha', 'কাঁথা'], expected: 'kantha' },
  // Product words with variant words mixed in
  { message: 'red jamdani', queries: ['red jamdani', 'রেড জামদানি'], expected: 'jamdani' },
  {
    message: 'black panjabi size 42',
    queries: ['black panjabi', 'ব্ল্যাক পাঞ্জাবি'],
    expected: 'panjabi',
  },
  { message: 'pink hijab', queries: ['pink hijab', 'পিংক হিজাব'], expected: 'hijab' },
  // Ambiguous: offer the candidates
  {
    message: 'saree dekhan',
    queries: ['saree', 'শাড়ি'],
    expected: { some: ['jamdani', 'katan'] },
  },
  { message: 'শাড়ি', queries: ['শাড়ি', 'shari'], expected: { some: ['jamdani', 'katan'] } },
  // Not sold here
  { message: 'iphone 15 ache?', queries: ['iphone 15', 'আইফোন ১৫'], expected: 'none' },
  { message: 'laptop', queries: ['laptop', 'ল্যাপটপ'], expected: 'none' },
  { message: 'jeans pant', queries: ['jeans pant', 'জিন্স প্যান্ট'], expected: 'none' },
  { message: 'perfume', queries: ['perfume', 'পারফিউম'], expected: 'none' },
  { message: 'sneakers', queries: ['sneakers', 'স্নিকার্স'], expected: 'none' },
  { message: 'red shoes', queries: ['red shoes', 'রেড সু'], expected: 'none' },
  { message: 'face cream', queries: ['face cream', 'ফেস ক্রিম'], expected: 'none' },
  { message: 'baby shoes', queries: ['baby shoes', 'বেবি সু'], expected: 'none' },
  { message: 'gamcha ache?', queries: ['gamcha', 'গামছা'], expected: 'none' },
  { message: 'watch', queries: ['watch', 'ওয়াচ'], expected: 'none' },
];

export interface VariantCase {
  product: string;
  queries: string[];
  /** The variant's option values, joined as its name; `none` when no variant fits. */
  expected: string | 'none' | { some: string[] };
}

export const VARIANT_CASES: VariantCase[] = [
  { product: 'jamdani', queries: ['red', 'রেড'], expected: 'Red' },
  { product: 'jamdani', queries: ['blue', 'ব্লু'], expected: 'Blue' },
  { product: 'jamdani', queries: ['sobuj', 'সবুজ'], expected: 'none' },
  { product: 'katan', queries: ['maroon', 'মেরুন'], expected: 'Maroon' },
  { product: 'katan', queries: ['meroon', 'মেরুন'], expected: 'Maroon' },
  { product: 'threepiece', queries: ['XL', 'এক্সএল'], expected: 'XL' },
  { product: 'threepiece', queries: ['L size', 'এল সাইজ'], expected: 'L' },
  { product: 'panjabi', queries: ['40 white', '৪০ হোয়াইট'], expected: '40 / White' },
  { product: 'panjabi', queries: ['black 42', 'ব্ল্যাক ৪২'], expected: '42 / Black' },
  {
    product: 'panjabi',
    queries: ['black', 'ব্ল্যাক'],
    expected: { some: ['38 / Black', '40 / Black', '42 / Black'] },
  },
  { product: 'lipstick', queries: ['ruby red', 'রুবি রেড'], expected: 'Ruby Red' },
  { product: 'lipstick', queries: ['nude', 'নুড'], expected: 'Nude' },
  { product: 'frock', queries: ['3-4 years', '৩-৪ বছর'], expected: '3-4Y' },
  { product: 'hijab', queries: ['pink', 'পিংক'], expected: 'Pink' },
];
