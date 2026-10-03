import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { LOGO_MIN_SIDE, type ShopLogo } from '@app/shared';
import {
  CodedBadRequestException,
  CodedUnsupportedMediaTypeException,
} from '../../../common/errors/coded-exceptions';
import { normalizeAvatar, type NormalizeAvatarResult } from '../../account/avatar/normalize-avatar';
import { DATABASE, type Database } from '../../database/database.module';
import { ObjectStorage } from '../../storage/object-storage';
import { ShopProfileRepository } from '../shop-profile.repository';
import { LOGO_OBJECT_OPTIONS, logoKey, logoKeyFromUrl } from './logo-keys';

function rejection(reason: Exclude<NormalizeAvatarResult, { ok: true }>['reason']) {
  switch (reason) {
    case 'unsupported':
      return new CodedUnsupportedMediaTypeException(
        'LOGO_UNSUPPORTED_TYPE',
        'Upload a JPEG, PNG or WebP image',
      );
    case 'too_small':
      return new CodedBadRequestException('LOGO_TOO_SMALL', 'The image is too small', {
        minSide: LOGO_MIN_SIDE,
      });
    case 'invalid':
      return new CodedBadRequestException('LOGO_INVALID', 'The file is not a usable image');
  }
}

/**
 * The shop's logo, normalized exactly as a profile photo is: one square JPEG
 * with every byte of metadata stripped. The object is written before
 * organization.logo points at it and deleted only after the row has moved off
 * it, so the logo a page shows always exists. Storage is never called inside
 * the transaction.
 */
@Injectable()
export class ShopLogoService {
  private readonly logger = new Logger(ShopLogoService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly profiles: ShopProfileRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(merchantId: string, file: Buffer): Promise<ShopLogo> {
    const normalized = await normalizeAvatar(file);
    if (!normalized.ok) {
      throw rejection(normalized.reason);
    }

    const key = logoKey(merchantId, randomUUID());
    await this.storage.put(key, normalized.image, LOGO_OBJECT_OPTIONS);
    const logo = this.storage.publicUrl(key);

    let previous: string | null;
    try {
      previous = await this.swap(merchantId, logo);
    } catch (error) {
      await this.deleteQuietly(key);
      throw error;
    }
    await this.deletePrevious(merchantId, previous);
    return { logo };
  }

  async remove(merchantId: string): Promise<ShopLogo> {
    const previous = await this.swap(merchantId, null);
    await this.deletePrevious(merchantId, previous);
    return { logo: null };
  }

  private swap(merchantId: string, logo: string | null): Promise<string | null> {
    return this.db.transaction((tx) => this.profiles.swapLogo(tx, { merchantId }, logo));
  }

  /** Only our own object for this shop; anything else is just forgotten. */
  private async deletePrevious(merchantId: string, previous: string | null): Promise<void> {
    const key = previous
      ? logoKeyFromUrl((k) => this.storage.publicUrl(k), merchantId, previous)
      : null;
    if (key) {
      await this.deleteQuietly(key);
    }
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.warn(`Could not delete logo object ${key}; it is left orphaned`);
    }
  }
}
