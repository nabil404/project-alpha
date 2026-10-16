import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantScope } from '../../database/base.repository';
import { DATABASE, type Database } from '../../database/database.module';
import { withMerchant } from '../../database/with-merchant';
import { normalizeProductImage } from '../../products/images/normalize-product-image';
import { PRODUCT_IMAGE_OBJECT_OPTIONS } from '../../products/images/product-image-keys';
import { ObjectStorage } from '../../storage/object-storage';
import { readDetails, type MessageDetails, type PhotoFailure } from '../message-content';
import { MessageRepository } from '../message.repository';
import { customerPhotoKey } from './customer-photo-keys';
import type { DownloadResult } from './photo-download';

/** The DI token for the download, so a test can stand in for Meta's CDN. */
export const PHOTO_DOWNLOADER = Symbol('PHOTO_DOWNLOADER');
export type PhotoDownloader = (url: string | null) => Promise<DownloadResult>;

/** Photos copied per message; Messenger sends at most ten in one. */
export const MAX_PHOTOS_PER_MESSAGE = 10;

export type StoredPhoto =
  { ok: true; key: string; url: string } | { ok: false; reason: PhotoFailure };

export interface PhotoCopies {
  photos: StoredPhoto[];
  /** A copy failed in a way worth trying again (storage was down); nothing was recorded for it. */
  transient: boolean;
}

type Copied = { key: string } | { failed: PhotoFailure } | null;

/**
 * Copies a customer's photos from Meta's expiring links into our bucket, so
 * the seller can still see them later and the vision call reads our copy.
 * Per invariant #1 the download and the upload run with no transaction open;
 * a short locked write then records each key on the message. The copy job and
 * the photo's turn may both run this; the keys are fixed per message, so the
 * loser of a race only rewrites the same object.
 */
@Injectable()
export class CustomerPhotoStore {
  private readonly logger = new Logger(CustomerPhotoStore.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly messages: MessageRepository,
    private readonly storage: ObjectStorage,
    @Inject(PHOTO_DOWNLOADER) private readonly download: PhotoDownloader,
  ) {}

  /** The message's photos, copied now when they were not yet; null for anything but a customer's photo. */
  async ensureStored(scope: TenantScope, messageId: string): Promise<PhotoCopies | null> {
    const row = await withMerchant(this.db, scope.merchantId, (tx) =>
      this.messages.findById(tx, scope, messageId),
    );
    if (!row || row.sender !== 'customer' || row.kind !== 'image') return null;
    const attachments = (readDetails(row.details).attachments ?? []).slice(
      0,
      MAX_PHOTOS_PER_MESSAGE,
    );

    let transient = false;
    const copied: Copied[] = [];
    for (const [index, attachment] of attachments.entries()) {
      if (attachment.key !== undefined || attachment.failed !== undefined) {
        copied.push(null);
        continue;
      }
      const result = await this.copy(scope.merchantId, messageId, index, attachment.url);
      if (result === 'transient') transient = true;
      copied.push(result === 'transient' ? null : result);
    }

    let details = readDetails(row.details);
    if (copied.some((entry) => entry !== null)) {
      details = await withMerchant(this.db, scope.merchantId, async (tx) => {
        const locked = await this.messages.findById(tx, scope, messageId, { lock: true });
        const current = readDetails(locked?.details);
        const merged = withCopies(current, copied);
        await this.messages.setDetails(tx, scope, messageId, merged);
        return merged;
      });
    }
    const photos = (details.attachments ?? [])
      .slice(0, MAX_PHOTOS_PER_MESSAGE)
      .map((attachment): StoredPhoto => {
        if (attachment.key !== undefined) {
          return { ok: true, key: attachment.key, url: this.storage.publicUrl(attachment.key) };
        }
        return { ok: false, reason: attachment.failed ?? 'failed' };
      });
    return { photos, transient };
  }

  private async copy(
    merchantId: string,
    messageId: string,
    index: number,
    url: string | null,
  ): Promise<Copied | 'transient'> {
    const downloaded = await this.download(url);
    if (!downloaded.ok) {
      this.logger.warn(
        `Could not download photo ${index} of message ${messageId}: ${downloaded.reason}`,
      );
      return { failed: downloaded.reason };
    }
    // Only the pixels survive: no EXIF, so no location from the customer's phone.
    const image = await normalizeProductImage(downloaded.body);
    if (!image.ok) return { failed: 'unreadable' };
    const key = customerPhotoKey(merchantId, messageId, index);
    try {
      await this.storage.put(key, image.full, PRODUCT_IMAGE_OBJECT_OPTIONS);
    } catch {
      return 'transient';
    }
    return { key };
  }
}

/** Each new copy written where the message has neither a key nor a failure yet. */
function withCopies(details: MessageDetails, copied: Copied[]): MessageDetails {
  const attachments = (details.attachments ?? []).map((attachment, index) => {
    const entry = copied[index];
    if (!entry || attachment.key !== undefined || attachment.failed !== undefined) {
      return attachment;
    }
    return { ...attachment, ...entry };
  });
  return { ...details, attachments };
}
