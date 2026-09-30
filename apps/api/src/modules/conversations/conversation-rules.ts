import { REPLY_WINDOW_MS, type CollectedSlots, type ConversationState } from '@app/shared';

/** How much of the last message the conversation list shows. */
export const PREVIEW_LENGTH = 140;

/** A customer whose profile could not be read, or lacks a name or picture, is asked for again after this long. */
export const PROFILE_RETRY_MS = 24 * 60 * 60 * 1000;

/** A named customer's profile is read again after this long, before their picture link expires. */
export const PROFILE_REFRESH_MS = 3 * PROFILE_RETRY_MS;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The list's one-line preview. Counted in graphemes, so an emoji with a skin
 * tone or a Bangla letter with its vowel sign is never cut in half.
 */
export function messagePreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const parts = Array.from(graphemes.segment(flat), (part) => part.segment);
  return parts.length <= PREVIEW_LENGTH ? flat : `${parts.slice(0, PREVIEW_LENGTH - 1).join('')}…`;
}

/**
 * Where a handed-off conversation resumes when the seller hands it back. The
 * assistant's state machine re-presents a summary if one is due.
 */
export function stateAfterHandBack(slots: CollectedSlots): ConversationState {
  return Object.values(slots).some((value) => value !== undefined)
    ? 'collecting_details'
    : 'browsing';
}

/** Messenger's standard window: a seller may reply until 24h after the customer's last message. */
export function isReplyWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < REPLY_WINDOW_MS;
}

export function replyWindowClosesAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt === null ? null : new Date(lastInboundAt.getTime() + REPLY_WINDOW_MS);
}

/** The customer wrote after the seller last opened the thread. */
export function isUnread(lastInboundAt: Date | null, sellerLastReadAt: Date | null): boolean {
  return lastInboundAt !== null && (sellerLastReadAt === null || lastInboundAt > sellerLastReadAt);
}

/**
 * Whether to ask Facebook for this customer's name and picture. A profile
 * missing either is retried daily: Facebook may share it later, and customers
 * read before pictures were asked for have none yet.
 */
export function needsProfile(
  customer: {
    name: string | null;
    pictureUrl: string | null;
    profileFetchedAt: Date | null;
  } | null,
  now: Date,
): boolean {
  if (customer === null || customer.profileFetchedAt === null) return true;
  const complete = customer.name !== null && customer.pictureUrl !== null;
  const wait = complete ? PROFILE_REFRESH_MS : PROFILE_RETRY_MS;
  return now.getTime() - customer.profileFetchedAt.getTime() >= wait;
}

export { likePattern } from '../database/like-pattern';
