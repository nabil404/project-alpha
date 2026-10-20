import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IMPORT_POST_PHOTO_MAX } from '@app/shared';
import type { PhotoDownloader } from '../conversations/photos/customer-photo.store';
import {
  normalizeProductImage,
  type NormalizedImage,
} from '../products/images/normalize-product-image';
import { deleteObjectsQuietly } from '../products/images/product-image-objects';
import {
  PRODUCT_IMAGE_OBJECT_OPTIONS,
  productImageKeys,
} from '../products/images/product-image-keys';
import { ObjectStorage } from '../storage/object-storage';

/** The DI token for the download, so a test can stand in for Meta's CDN. */
export const IMPORT_PHOTO_DOWNLOADER = Symbol('IMPORT_PHOTO_DOWNLOADER');

/** A photo stored as a product image's objects, ready for its row. */
export interface StoredImage {
  id: string;
  storageKey: string;
  url: string;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * A post's photos, read from Meta's expiring links and re-encoded as product
 * photos are. Never inside a transaction (invariant #1): the objects land
 * under `m/` before the rows that name them are written, and the orphan
 * sweep removes any a failed write leaves.
 */
@Injectable()
export class ImportPhotos {
  private readonly logger = new Logger(ImportPhotos.name);

  constructor(
    private readonly storage: ObjectStorage,
    @Inject(IMPORT_PHOTO_DOWNLOADER) private readonly download: PhotoDownloader,
  ) {}

  /** Up to IMPORT_POST_PHOTO_MAX photos, or null when any of them cannot be read. */
  async read(urls: readonly string[]): Promise<NormalizedImage[] | null> {
    const images: NormalizedImage[] = [];
    for (const url of urls.slice(0, IMPORT_POST_PHOTO_MAX)) {
      const downloaded = await this.download(url);
      if (!downloaded.ok) {
        this.logger.warn(`Could not download a post photo: ${downloaded.reason}`);
        return null;
      }
      const image = await normalizeProductImage(downloaded.body);
      if (!image.ok) return null;
      images.push(image);
    }
    return images;
  }

  /** One copy of each photo under new image ids. Throws when storage refuses, after removing what it stored. */
  async store(merchantId: string, images: readonly NormalizedImage[]): Promise<StoredImage[]> {
    const stored: StoredImage[] = [];
    try {
      for (const image of images) {
        const id = randomUUID();
        const keys = productImageKeys(merchantId, id);
        await this.storage.put(keys.full, image.full, PRODUCT_IMAGE_OBJECT_OPTIONS);
        await this.storage.put(keys.thumbnail, image.thumbnail, PRODUCT_IMAGE_OBJECT_OPTIONS);
        stored.push({
          id,
          storageKey: keys.full,
          url: this.storage.publicUrl(keys.full),
          width: image.width,
          height: image.height,
          byteSize: image.byteSize,
        });
      }
    } catch (error) {
      await this.discard(merchantId, stored);
      throw error;
    }
    return stored;
  }

  /** Best effort; the orphan sweep removes what this misses. */
  async discard(merchantId: string, images: readonly StoredImage[]): Promise<void> {
    await deleteObjectsQuietly(
      this.storage,
      this.logger,
      images.flatMap((image) => {
        const keys = productImageKeys(merchantId, image.id);
        return [keys.full, keys.thumbnail];
      }),
    );
  }
}
