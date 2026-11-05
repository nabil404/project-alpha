import type { Category } from '@app/shared';
import { checkReply } from '../reply-check';
import {
  allowedFrom,
  latestCustomerWords,
  shopFactLookup,
  shopFacts,
  type ShopFactsInput,
} from '../shop-facts';
import { EVAL_PRODUCTS, productByKey } from './fixtures/match-eval';

const SAREES: Category = { id: '00000000-0000-4000-8000-0000000ca001', name: 'Sarees' } as Category;
const jamdani = productByKey('jamdani');
const katan = productByKey('katan');
const lungi = productByKey('lungi');
const DHAKA = '00000000-0000-4000-8000-00000000d001';

/** Intl puts a no-break space after the currency code. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('\u00a0', ' '));

const input = (overrides: Partial<ShopFactsInput> = {}): ShopFactsInput => ({
  delivery: [
    { id: DHAKA, areaName: 'Dhaka', charge: 6_000, deliveryTime: '1-2 days' },
    {
      id: '00000000-0000-4000-8000-00000000d009',
      areaName: null,
      charge: 12_000,
      deliveryTime: null,
    },
  ],
  freeDeliveryOver: 300_000,
  currency: 'BDT',
  pickupAddress: 'Shop 4, New Market, Dhaka',
  contactPhone: '+8801812000000',
  notes: 'Cash on delivery only. Exchange within 3 days.',
  catalog: {
    products: EVAL_PRODUCTS.map((product) =>
      product.id === jamdani.id || product.id === katan.id
        ? { ...product, categoryIds: [SAREES.id] }
        : product,
    ),
    categories: [SAREES],
  },
  orderProductIds: [],
  words: 'delivery charge koto?',
  language: 'en',
  ...overrides,
});

describe('shopFacts', () => {
  it("lists the shop's delivery, pickup, phone, notes and categories, in that order", () => {
    expect(plain(shopFacts(input()).facts)).toEqual([
      { about: 'Delivery charge', text: 'Dhaka: BDT 60, 1-2 days' },
      { about: 'Delivery charge', text: 'Everywhere else: BDT 120' },
      { about: 'Free delivery', text: 'On orders over BDT 3,000' },
      { about: 'Pickup address', text: 'Shop 4, New Market, Dhaka' },
      { about: 'Shop phone', text: '+8801812000000' },
      { about: "Seller's notes", text: 'Cash on delivery only. Exchange within 3 days.' },
      { about: 'Categories', text: 'Sarees' },
    ]);
  });

  it('leaves out what the shop has not set', () => {
    const facts = shopFacts(
      input({
        delivery: [],
        freeDeliveryOver: null,
        pickupAddress: null,
        contactPhone: null,
        notes: '  ',
        catalog: { products: EVAL_PRODUCTS, categories: [] },
      }),
    );
    expect(facts.facts).toEqual([]);
    expect(facts.allowed).toEqual({ facts: [] });
  });

  it('adds a product the question names, with each variant price and stock', () => {
    const product = plain(shopFacts(input({ words: 'jamdani saree er dam koto?' })).facts).find(
      (fact) => fact.about === 'Product',
    );
    expect(product?.text).toMatch(/^Jamdani Saree\. Red: BDT [\d,]+, in stock; Blue: /);
  });

  it('adds the products already in the order, before the ones the question names, once each', () => {
    const products = shopFacts(
      input({ orderProductIds: [lungi.id, jamdani.id], words: 'jamdani ki cotton?' }),
    ).facts.filter((fact) => fact.about === 'Product');
    expect(products.map((fact) => fact.text.split('.')[0])).toEqual([
      'Check Lungi',
      'Jamdani Saree',
    ]);
  });

  it("states a product's description and its own delivery charges", () => {
    const own = {
      ...jamdani,
      description: 'Handwoven cotton, 6 yards.',
      customDelivery: true,
      deliveryCharges: [{ deliveryChargeId: DHAKA, charge: 0 }],
    };
    const fact = plain(
      shopFacts(input({ catalog: { products: [own], categories: [] }, words: 'jamdani' })).facts,
    ).find((entry) => entry.about === 'Product');
    expect(fact?.text).toContain('Description: Handwoven cotton, 6 yards.');
    expect(fact?.text).toContain('Delivery for this product: Dhaka BDT 0');
  });

  it('lists what is in stock in a category the question names, from its lowest price', () => {
    const listing = plain(shopFacts(input({ words: 'what sarees do you have' })).facts).find(
      (fact) => fact.about.startsWith('In stock in'),
    );
    expect(listing?.about).toBe('In stock in Sarees');
    expect(listing?.text).toMatch(/^Jamdani Saree \(from BDT [\d,]+\), Katan Silk Saree \(from /);
  });

  it('lets a reply quote the facts and the shop phone, written the national way', () => {
    const { allowed } = shopFacts(input());
    expect(checkReply('Dhaka delivery is BDT 60, 1-2 days. Call 01812000000.', allowed)).toEqual({
      ok: true,
    });
    expect(checkReply('Delivery is BDT 50.', allowed)).toEqual({ ok: false, reason: 'number' });
  });
});

describe('shopFactLookup', () => {
  const lookup = shopFactLookup(input());

  it('finds the product the words name, written as the turn writes it', () => {
    const found = plain(lookup.findProduct('jamdani shari'));
    expect(found.map((fact) => fact.text.split('.')[0])).toEqual(['Jamdani Saree']);
    const given = plain(shopFacts(input({ words: 'jamdani shari' })).facts);
    expect(given).toContainEqual(found[0]);
  });

  it('finds nothing for words no product is named', () => {
    expect(lookup.findProduct('bicycle helmet')).toEqual([]);
  });

  it('lists a category the name is close to, not only one spelt exactly', () => {
    for (const name of ['saree', 'SAREES', 'sarees collection']) {
      expect(lookup.listCategory(name).map((fact) => fact.about)).toEqual(['In stock in Sarees']);
    }
    expect(lookup.listCategory('shoes')).toEqual([]);
    expect(lookup.listCategory('  ')).toEqual([]);
  });

  it('lets a reply quote a looked-up fact once it is allowed', () => {
    const [fact] = plain(lookup.findProduct('katan'));
    const price = fact!.text.match(/BDT [\d,]+/)![0];
    const reply = `The katan is ${price}.`;
    expect(checkReply(reply, shopFacts(input()).allowed)).toEqual({ ok: false, reason: 'number' });
    expect(checkReply(reply, allowedFrom([fact!], null))).toEqual({ ok: true });
  });
});

describe('latestCustomerWords', () => {
  it("joins the customer's lines since anyone else spoke", () => {
    expect(
      latestCustomerWords([
        { from: 'customer', text: 'hi' },
        { from: 'assistant', text: 'Which product?' },
        { from: 'customer', text: 'delivery koto' },
        { from: 'customer', text: 'dhaka te' },
      ]),
    ).toBe('delivery koto dhaka te');
  });
});
