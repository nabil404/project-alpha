import { formatMinorUnitsTrimmed, MAX_QUICK_REPLIES, type Product } from '@app/shared';
import { LOCALES, type ReplyLanguage } from './assistant-fallbacks';
import type { CatalogView } from './catalog-match';
import type { Choice, ProductCard, ReplyIntent } from './reply-intent';

/** 12 categories and "Other" fill Messenger's 13 quick replies. */
export const MAX_CATEGORY_CHOICES = MAX_QUICK_REPLIES - 1;
export const MAX_CAROUSEL_CARDS = 10;

/** Draft Bangla, to be reviewed. */
const OTHER: Record<ReplyLanguage, string> = { bn: 'অন্যান্য', en: 'Other' };
const FROM: Record<ReplyLanguage, (price: string) => string> = {
  bn: (price) => `${price} থেকে`,
  en: (price) => `From ${price}`,
};

const browsable = (product: Product) => product.variants.some((variant) => variant.available > 0);

interface Bucket {
  choice: Choice;
  products: Product[];
}

/**
 * Browsing, decided in code: the category list, or one category's products as
 * carousel cards. Only products with something available show, and a price is
 * always the lowest available variant's, so nothing is quoted that cannot be sold.
 */
export function browseReply(
  catalog: CatalogView,
  categoryId: string | 'other' | null,
  language: ReplyLanguage,
  currency: string,
): ReplyIntent {
  const buckets = bucketsOf(catalog, catalog.products.filter(browsable), language);
  if (buckets.length === 0) return { kind: 'handoff', reason: 'awaiting_seller' };
  const chosen =
    categoryId === null
      ? buckets.length === 1
        ? buckets[0]
        : undefined
      : buckets.find((bucket) => bucket.choice.id === categoryId);
  if (!chosen) {
    return { kind: 'browse_categories', choices: buckets.map((bucket) => bucket.choice) };
  }
  return {
    kind: 'browse_products',
    cards: chosen.products
      .slice(0, MAX_CAROUSEL_CARDS)
      .map((product) => cardOf(product, language, currency)),
    more: chosen.products.length > MAX_CAROUSEL_CARDS,
  };
}

function bucketsOf(catalog: CatalogView, products: Product[], language: ReplyLanguage): Bucket[] {
  const buckets: Bucket[] = catalog.categories
    .map((category) => ({
      choice: { id: category.id, title: category.name },
      products: products.filter((product) => product.categoryIds.includes(category.id)),
    }))
    .filter((bucket) => bucket.products.length > 0)
    .slice(0, MAX_CATEGORY_CHOICES);
  const loose = products.filter((product) => product.categoryIds.length === 0);
  if (loose.length > 0) {
    buckets.push({ choice: { id: 'other', title: OTHER[language] }, products: loose });
  }
  return buckets;
}

function cardOf(product: Product, language: ReplyLanguage, currency: string): ProductCard {
  const lowest = Math.min(
    ...product.variants.filter((variant) => variant.available > 0).map((variant) => variant.price),
  );
  const cover = product.images.find((image) => image.id === product.coverImageId);
  return {
    id: product.id,
    title: product.name,
    subtitle: FROM[language](formatMinorUnitsTrimmed(lowest, currency, LOCALES[language])),
    imageUrl: cover?.url ?? null,
  };
}
