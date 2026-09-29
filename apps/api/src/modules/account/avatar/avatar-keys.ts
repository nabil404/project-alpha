import type { PutOptions } from '../../storage/object-storage';

/** Objects are never overwritten - a new photo is a new key - so caches may keep them forever. */
export const AVATAR_OBJECT_OPTIONS: PutOptions = {
  contentType: 'image/jpeg',
  cacheControl: 'public, max-age=31536000, immutable',
};

const USER_ID = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AVATAR_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

function avatarPrefix(userId: string): string {
  if (!USER_ID.test(userId)) {
    throw new Error('avatarKey: userId would not round-trip');
  }
  return `u/${userId}/avatar/`;
}

/**
 * Built only here, from the session's user id and a server-made uuid - never
 * from anything in a request. Lives outside `m/`, which the product image
 * sweep lists and would otherwise treat as orphans.
 */
export function avatarKey(userId: string, avatarId: string): string {
  if (!UUID.test(avatarId)) {
    throw new Error('avatarKey: avatarId is not a uuid');
  }
  return `${avatarPrefix(userId)}${avatarId}.jpg`;
}

/**
 * The key behind `url` when it is this user's avatar in our bucket, or null -
 * for a Google photo from sign-up, another user's avatar, or anything else.
 * The only place a stored photo URL is parsed.
 */
export function avatarKeyFromUrl(
  publicUrl: (key: string) => string,
  userId: string,
  url: string,
): string | null {
  const prefix = avatarPrefix(userId);
  const urlPrefix = publicUrl(prefix);
  if (!url.startsWith(urlPrefix)) {
    return null;
  }
  const file = url.slice(urlPrefix.length);
  return AVATAR_FILE.test(file) ? `${prefix}${file}` : null;
}
