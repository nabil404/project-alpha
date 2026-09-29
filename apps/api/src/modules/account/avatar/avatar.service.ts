import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AVATAR_MIN_SIDE, type AccountAvatar } from '@app/shared';
import {
  CodedBadRequestException,
  CodedUnsupportedMediaTypeException,
} from '../../../common/errors/coded-exceptions';
import { ObjectStorage } from '../../storage/object-storage';
import { AVATAR_OBJECT_OPTIONS, avatarKey, avatarKeyFromUrl } from './avatar-keys';
import { normalizeAvatar, type NormalizeAvatarResult } from './normalize-avatar';
import { UserImageRepository } from './user-image.repository';

function rejection(reason: Exclude<NormalizeAvatarResult, { ok: true }>['reason']) {
  switch (reason) {
    case 'unsupported':
      return new CodedUnsupportedMediaTypeException(
        'AVATAR_UNSUPPORTED_TYPE',
        'Upload a JPEG, PNG or WebP image',
      );
    case 'too_small':
      return new CodedBadRequestException('AVATAR_TOO_SMALL', 'The image is too small', {
        minSide: AVATAR_MIN_SIDE,
      });
    case 'invalid':
      return new CodedBadRequestException('AVATAR_INVALID', 'The file is not a usable image');
  }
}

/**
 * The seller's profile photo. The object is written before user.image points
 * at it and deleted only after user.image has moved off it, so the photo a
 * page shows always exists. A delete that fails is logged and the object left
 * behind: there is no sweep for avatars.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly users: UserImageRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(userId: string, file: Buffer): Promise<AccountAvatar> {
    const normalized = await normalizeAvatar(file);
    if (!normalized.ok) {
      throw rejection(normalized.reason);
    }

    const key = avatarKey(userId, randomUUID());
    await this.storage.put(key, normalized.image, AVATAR_OBJECT_OPTIONS);
    const image = this.storage.publicUrl(key);

    let previous: string | null;
    try {
      previous = await this.users.swapImage(userId, image);
    } catch (error) {
      await this.deleteQuietly(key);
      throw error;
    }
    await this.deletePrevious(userId, previous);
    return { image };
  }

  async remove(userId: string): Promise<AccountAvatar> {
    const previous = await this.users.swapImage(userId, null);
    await this.deletePrevious(userId, previous);
    return { image: null };
  }

  /** Only our own object for this user; a Google photo URL is just forgotten. */
  private async deletePrevious(userId: string, previous: string | null): Promise<void> {
    const key = previous
      ? avatarKeyFromUrl((k) => this.storage.publicUrl(k), userId, previous)
      : null;
    if (key) {
      await this.deleteQuietly(key);
    }
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.warn(`Could not delete avatar object ${key}; it is left orphaned`);
    }
  }
}
