import { formatMinorUnitsTrimmed, MAX_ANSWER_FACTS, type SellableProduct } from '@app/shared';
import type { ShopFact } from '../../llm/agents/shop-answer/shop-answer.agent';
import type { ChatLine } from '../../llm/llm.types';
import { LOCALES, type ReplyLanguage } from './assistant-fallbacks';
import { matchProduct, type CatalogView } from './catalog-match';

/** Answer calls one conversation may make in 24 hours; past it, a question goes to the seller. */
export const ANSWERS_PER_DAY = 10;

/** Products a category listing names; the rest are left out. */
export const MAX_LISTED_PRODUCTS = 10;

/** One of the shop's delivery rows as an answer may quote it. */
export interface DeliveryFactRow {
  id: string;
  /** Null for the everywhere-else row. */
  areaName: string | null;
  charge: number;
  deliveryTime: string | null;
}

/** Everything a shop answer may draw on, read by the turn for its own merchant only. */
export interface ShopFactsInput {
  delivery: DeliveryFactRow[];
  freeDeliveryOver: number | null;
  currency: string;
  pickupAddress: string | null;
  contactPhone: string | null;
  /** The seller's notes from Settings > Order assistant; '' when none. */
  notes: string;
  catalog: CatalogView;
  /** Products already in the order, by id. */
  orderProductIds: string[];
  /** The customer's question. */
  words: string;
  language: ReplyLanguage;
}

/** The facts, numbered by position, and what `checkReply` may allow from them. */
export interface ShopFacts {
  facts: ShopFact[];
  /** Every value a reply may quote a number from; `phone` lets it write the number any usual way. */
  allowed: { facts: string[]; phone?: string };
}

/**
 * The facts a shop answer may use, chosen by code: the shop's delivery,
 * pickup and contact settings, the seller's notes, the categories, and the
 * catalog's products the order holds, the question names, or a category the
 * question names lists. Prices and stock come from the catalog only.
 */
export function shopFacts(input: ShopFactsInput): ShopFacts {
  const money = (amount: number) =>
    formatMinorUnitsTrimmed(amount, input.currency, LOCALES[input.language]);
  const areaNames = new Map(
    input.delivery.map((row) => [row.id, row.areaName ?? 'Everywhere else']),
  );
  const facts: ShopFact[] = [];

  for (const row of input.delivery) {
    const time = row.deliveryTime ? `, ${row.deliveryTime}` : '';
    facts.push({
      about: 'Delivery charge',
      text: `${row.areaName ?? 'Everywhere else'}: ${money(row.charge)}${time}`,
    });
  }
  if (input.freeDeliveryOver !== null) {
    facts.push({
      about: 'Free delivery',
      text: `On orders over ${money(input.freeDeliveryOver)}`,
    });
  }
  if (input.pickupAddress) facts.push({ about: 'Pickup address', text: input.pickupAddress });
  if (input.contactPhone) facts.push({ about: 'Shop phone', text: input.contactPhone });
  if (input.notes.trim()) facts.push({ about: "Seller's notes", text: input.notes.trim() });

  const { catalog } = input;
  if (catalog.categories.length > 0) {
    facts.push({
      about: 'Categories',
      text: catalog.categories.map((category) => category.name).join(', '),
    });
  }

  const productFact = (product: SellableProduct): ShopFact => {
    const variants = product.variants.map((variant) => {
      const stock = variant.available > 0 ? 'in stock' : 'out of stock';
      const name = variant.name ? `${variant.name}: ` : '';
      return `${name}${money(variant.price)}, ${stock}`;
    });
    const parts = [`${product.name}. ${variants.join('; ')}`];
    const description = product.description?.trim().replace(/\.+$/, '');
    if (description) parts.push(`Description: ${description}`);
    if (product.customDelivery && product.deliveryCharges.length > 0) {
      const charges = product.deliveryCharges.map(
        (row) => `${areaNames.get(row.deliveryChargeId) ?? 'Elsewhere'} ${money(row.charge)}`,
      );
      parts.push(`Delivery for this product: ${charges.join('; ')}`);
    }
    return { about: 'Product', text: parts.join('. ') };
  };

  const seen = new Set<string>();
  const addProduct = (product: SellableProduct | undefined) => {
    if (!product || seen.has(product.id)) return;
    seen.add(product.id);
    facts.push(productFact(product));
  };
  const byId = (id: string) => catalog.products.find((product) => product.id === id);

  for (const id of input.orderProductIds) addProduct(byId(id));

  const words = input.words.trim();
  if (words) {
    const named = matchProduct([words], catalog);
    const ids =
      named.kind === 'one' ? [named.productId] : named.kind === 'some' ? named.productIds : [];
    for (const id of ids) addProduct(byId(id));

    const lowered = words.toLocaleLowerCase();
    for (const category of catalog.categories) {
      if (!lowered.includes(category.name.toLocaleLowerCase())) continue;
      const listed = catalog.products
        .filter(
          (product) =>
            product.categoryIds.includes(category.id) &&
            product.variants.some((variant) => variant.available > 0),
        )
        .slice(0, MAX_LISTED_PRODUCTS)
        .map((product) => {
          const from = Math.min(...product.variants.map((variant) => variant.price));
          return `${product.name} (from ${money(from)})`;
        });
      facts.push({
        about: `In stock in ${category.name}`,
        text: listed.length > 0 ? listed.join(', ') : 'Nothing in stock',
      });
    }
  }

  const kept = facts.slice(0, MAX_ANSWER_FACTS);
  return {
    facts: kept,
    allowed: {
      facts: kept.map((fact) => fact.text),
      ...(input.contactPhone ? { phone: input.contactPhone } : {}),
    },
  };
}

/** The customer's latest words: their lines since the shop or the assistant last spoke. */
export function latestCustomerWords(history: ChatLine[]): string {
  const lines: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const line = history[index]!;
    if (line.from !== 'customer') break;
    lines.unshift(line.text);
  }
  return lines.join(' ');
}
