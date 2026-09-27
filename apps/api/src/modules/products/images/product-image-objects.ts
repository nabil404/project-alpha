import type { Logger } from '@nestjs/common';
import type { ProductImageRow } from '../../../database/schema/index';
import type { ObjectStorage } from '../../storage/object-storage';
import { productImageKeys } from './product-image-keys';

/** Both objects of each row: the full image and its thumbnail. */
export function objectKeysFor(rows: ProductImageRow[]): string[] {
  return rows.flatMap((row) => [
    row.storageKey,
    productImageKeys(row.merchantId, row.id).thumbnail,
  ]);
}

/**
 * Best effort, and only ever after the rows are committed away: a failure is
 * logged and left to the orphan sweep, never surfaced to the seller.
 */
export async function deleteObjectsQuietly(
  storage: ObjectStorage,
  logger: Logger,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch {
      logger.warn(`Could not delete object ${key}; the orphan sweep will remove it`);
    }
  }
}
