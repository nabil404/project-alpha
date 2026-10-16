import { MAX_PHOTO_MATCHES, type PhotoMatch, type Product } from '@app/shared';
import type { PhotoMatchRequest } from '../../llm/llm.types';
import type { MessageRow } from '../../database/schema/index';
import { isEmojiOnly } from '../message-content';
import { matchProduct, type CatalogView, type ProductMatch } from './catalog-match';
import { CONFIDENCE_FLOOR } from './conversation-machine';

/** Photos one turn sends to the vision call; any more in the burst are left to the seller. */
export const MAX_PHOTOS_PER_TURN = 3;
/** Products one vision call compares against, as small thumbnails. */
export const MAX_PHOTO_CANDIDATES = 20;
/** Vision calls one conversation may make in a day; past it, the seller looks at the photos. */
export const VISION_CALLS_PER_DAY = 6;

/**
 * The photo messages in the burst the trigger ends (the customer's messages
 * since the last reply), newest first and at most MAX_PHOTOS_PER_TURN, with
 * the words typed beside them. Null when the burst has no photo.
 */
export function photosIn(
  recent: MessageRow[],
  triggerMessageId: string,
): { messageIds: string[]; words: string } | null {
  const index = recent.findIndex((message) => message.id === triggerMessageId);
  if (index < 0) return null;
  const messageIds: string[] = [];
  const words: string[] = [];
  for (const message of recent.slice(index)) {
    if (message.sender !== 'customer') break;
    if (message.deletedAt !== null) continue;
    if (message.kind === 'image') messageIds.push(message.id);
    const text = (message.editedText ?? message.text).trim();
    if (message.kind === 'text' && text && !isEmojiOnly(text)) words.unshift(text);
  }
  if (messageIds.length === 0) return null;
  return { messageIds: messageIds.slice(0, MAX_PHOTOS_PER_TURN), words: words.join('\n') };
}

/**
 * The products a photo is compared with: sellable ones with a cover, from a
 * category the customer named when they named one, and any product their
 * words name first. The catalog is the turn's merchant's only.
 */
export function photoShortlist(catalog: CatalogView, words: string): Product[] {
  const sellable = catalog.products.filter(
    (product) =>
      product.variants.some((variant) => variant.available > 0) && coverThumbnail(product),
  );
  const lowered = words.toLocaleLowerCase();
  const named = catalog.categories.filter(
    (category) => lowered && lowered.includes(category.name.toLocaleLowerCase()),
  );
  const inNamed = sellable.filter((product) =>
    product.categoryIds.some((id) => named.some((category) => category.id === id)),
  );
  const pool = inNamed.length > 0 ? inNamed : sellable;
  const match: ProductMatch = words
    ? matchProduct([words], { ...catalog, products: pool })
    : { kind: 'none' };
  const first =
    match.kind === 'one' ? [match.productId] : match.kind === 'some' ? match.productIds : [];
  const ranked = [
    ...pool.filter((product) => first.includes(product.id)),
    ...pool.filter((product) => !first.includes(product.id)),
  ];
  return ranked.slice(0, MAX_PHOTO_CANDIDATES);
}

/** The vision call's request: our copies of the photos, each candidate numbered from 1. */
export function photoMatchRequest(
  photos: string[],
  shortlist: Product[],
  words: string,
): PhotoMatchRequest {
  return {
    photos,
    candidates: shortlist.map((product, index) => ({
      number: index + 1,
      name: product.name,
      imageUrl: coverThumbnail(product)!,
    })),
    ...(words ? { words } : {}),
  };
}

/**
 * The product ids a match names, best first: numbers we did not show are
 * dropped, as is anything below the confidence floor, and a product named
 * twice counts once.
 */
export function matchedProductIds(match: PhotoMatch, shortlist: Product[]): string[] {
  const ids: string[] = [];
  const sure = match.matches
    .filter((entry) => entry.confidence >= CONFIDENCE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence);
  for (const entry of sure) {
    const product = shortlist[entry.candidate - 1];
    if (product && !ids.includes(product.id)) ids.push(product.id);
  }
  return ids.slice(0, MAX_PHOTO_MATCHES);
}

function coverThumbnail(product: Product): string | undefined {
  return product.images.find((image) => image.id === product.coverImageId)?.thumbnailUrl;
}
