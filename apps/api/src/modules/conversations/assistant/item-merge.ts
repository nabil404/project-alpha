import type { ExtractedItem, OrderItemSlot } from '@app/shared';

export interface MergedItems {
  items: OrderItemSlot[];
  /** For each merged item, the collected item its `ref` continued, its words changed or not. */
  refs: (number | null)[];
}

const words = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Applies extracted items to the customer's list; a null list changes nothing.
 * An entry whose `ref` names a collected item continues it. Product words on
 * it mean the product changed, so it matches again, as does an echoed
 * re-mention rather than keep a product the customer turned down. Null words
 * keep its ids, and variants work the same way. A missing or reused `ref`
 * starts a new item, an entry with no product words and nothing to continue is
 * dropped, and a collected item left out is removed.
 */
export function mergeItems(
  current: readonly OrderItemSlot[],
  extracted: readonly ExtractedItem[] | null,
): MergedItems {
  if (extracted === null) {
    const same = current.map((_, index) => index);
    return { items: [...current], refs: same };
  }
  const used = new Set<number>();
  const items: OrderItemSlot[] = [];
  const refs: (number | null)[] = [];
  for (const entry of extracted) {
    const ref =
      entry.ref !== null && entry.ref < current.length && !used.has(entry.ref) ? entry.ref : null;
    if (ref !== null) used.add(ref);
    const kept = ref === null ? undefined : current[ref];
    const product = words(entry.productQuery);
    if (product === undefined && kept === undefined) continue;

    const next: OrderItemSlot =
      product === undefined
        ? { ...kept }
        : { productQuery: product, ...optional('productQueryAlt', words(entry.productQueryAlt)) };

    const variant = words(entry.variantQuery);
    if (variant !== undefined) {
      delete next.variantId;
      next.variantQuery = variant;
      const alt = words(entry.variantQueryAlt);
      if (alt === undefined) delete next.variantQueryAlt;
      else next.variantQueryAlt = alt;
    }
    const quantity = entry.quantity ?? kept?.quantity;
    if (quantity === undefined) delete next.quantity;
    else next.quantity = quantity;

    items.push(next);
    refs.push(ref);
  }
  return { items, refs };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/**
 * Two items resolved to the same variant become one, at the first one's
 * place, their quantities summed (a missing quantity counts as none given).
 * Returns, for each original index, the index it ended up at.
 */
export function mergeSameVariant(items: readonly OrderItemSlot[]): {
  items: OrderItemSlot[];
  moved: number[];
} {
  const merged: OrderItemSlot[] = [];
  const at = new Map<string, number>();
  const moved: number[] = [];
  for (const item of items) {
    const existing = item.variantId === undefined ? undefined : at.get(item.variantId);
    if (existing === undefined) {
      if (item.variantId !== undefined) at.set(item.variantId, merged.length);
      moved.push(merged.length);
      merged.push({ ...item });
      continue;
    }
    const target = merged[existing]!;
    const quantity =
      target.quantity === undefined && item.quantity === undefined
        ? undefined
        : (target.quantity ?? 0) + (item.quantity ?? 0);
    if (quantity !== undefined) target.quantity = quantity;
    moved.push(existing);
  }
  return { items: merged, moved };
}
