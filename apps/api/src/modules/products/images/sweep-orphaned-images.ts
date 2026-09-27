import type { ObjectStorage } from '../../storage/object-storage.js';
import { parseProductImageKey, PRODUCT_IMAGE_KEY_ROOT } from './product-image-keys.js';

export interface SweepDependencies {
  storage: ObjectStorage;
  /**
   * Which of these ids still have a product_image row for this merchant. Must
   * run under that merchant's context: without one, row-level security shows
   * the runtime role no rows, and every object would look orphaned.
   */
  existingImageIds: (merchantId: string, imageIds: string[]) => Promise<Set<string>>;
  now: () => Date;
}

export interface SweepOptions {
  /** Younger objects are left alone: their upload may not have committed its row yet. */
  minAgeMs: number;
  /** Abort when orphans exceed this share of examined objects... */
  maxDeleteRatio: number;
  /** ...and number more than this, so a tiny bucket does not trip it nightly. */
  breakerFloor: number;
}

export const SWEEP_DEFAULTS: SweepOptions = {
  minAgeMs: 24 * 3_600_000,
  maxDeleteRatio: 0.2,
  breakerFloor: 10,
};

export interface SweepReport {
  examined: number;
  skipped: number;
  orphans: number;
  deleted: number;
  aborted: boolean;
}

const LOOKUP_CHUNK = 500;

/** Deletes objects under m/ whose image has no row. Never deletes a key it cannot parse. */
export async function sweepOrphanedImages(
  deps: SweepDependencies,
  options: SweepOptions = SWEEP_DEFAULTS,
): Promise<SweepReport> {
  const cutoff = deps.now().getTime() - options.minAgeMs;
  // merchant -> image id -> that image's object keys (old enough to judge)
  const candidates = new Map<string, Map<string, string[]>>();
  let examined = 0;
  let skipped = 0;

  let cursor: string | null = null;
  do {
    const page = await deps.storage.list(PRODUCT_IMAGE_KEY_ROOT, cursor);
    for (const object of page.objects) {
      examined += 1;
      const parsed = parseProductImageKey(object.key);
      if (!parsed) {
        skipped += 1;
        continue;
      }
      if (object.lastModified.getTime() > cutoff) continue;
      const byImage = candidates.get(parsed.merchantId) ?? new Map<string, string[]>();
      byImage.set(parsed.imageId, [...(byImage.get(parsed.imageId) ?? []), object.key]);
      candidates.set(parsed.merchantId, byImage);
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  const orphanKeys: string[] = [];
  for (const [merchantId, byImage] of candidates) {
    const ids = [...byImage.keys()];
    for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
      const chunk = ids.slice(start, start + LOOKUP_CHUNK);
      const existing = await deps.existingImageIds(merchantId, chunk);
      for (const id of chunk) {
        if (!existing.has(id)) orphanKeys.push(...(byImage.get(id) ?? []));
      }
    }
  }

  const orphans = orphanKeys.length;
  if (orphans > options.breakerFloor && orphans / examined > options.maxDeleteRatio) {
    return { examined, skipped, orphans, deleted: 0, aborted: true };
  }

  let deleted = 0;
  for (const key of orphanKeys) {
    await deps.storage.delete(key);
    deleted += 1;
  }
  return { examined, skipped, orphans, deleted, aborted: false };
}
