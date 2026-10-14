import type { MessageKind } from '@app/shared';
import { z } from 'zod';
import type { InboundAttachment } from '../queue/queue.constants';

/** The `message.details` column: what a message without words carried. */
export const messageDetailsSchema = z.object({
  attachments: z
    .array(z.object({ url: z.string().nullable(), stickerId: z.string().nullable().optional() }))
    .optional(),
  location: z.object({ lat: z.number(), long: z.number() }).optional(),
  /** Posts and links shared or pasted; see SharedLink. */
  links: z
    .array(
      z.object({
        url: z.string().nullable(),
        title: z.string().nullable(),
        postId: z.string().nullable(),
      }),
    )
    .optional(),
  reaction: z
    .object({
      emoji: z.string(),
      label: z.string(),
      targetMid: z.string(),
      /** Our row for the message reacted to; null when it was never stored. */
      targetMessageId: z.string().nullable(),
    })
    .optional(),
});
export type MessageDetails = z.infer<typeof messageDetailsSchema>;

/** Details written by an older shape read as none rather than failing the thread. */
export function readDetails(value: unknown): MessageDetails {
  const parsed = messageDetailsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** Meta's Like sticker, in its three sizes: the 👍 a customer taps beside the composer. */
export const LIKE_STICKER_IDS: ReadonlySet<string> = new Set([
  '369239263222822',
  '369239343222814',
  '369239383222810',
]);

/**
 * A message's kind, text and details, from what Meta sent. The text holds no
 * words in any language: the dashboard names the kind in the seller's own.
 */
export function attachmentContent(attachments: InboundAttachment[]): {
  kind: MessageKind;
  text: string;
  details: MessageDetails;
} {
  const first = attachments[0];
  if (!first) return { kind: 'other', text: '', details: {} };
  if (first.type === 'location') {
    return {
      kind: 'location',
      text: '',
      details: { location: { lat: first.lat, long: first.long } },
    };
  }
  const files = attachments.flatMap((attachment) =>
    attachment.type === 'location'
      ? []
      : [
          attachment.type === 'sticker'
            ? { url: attachment.url, stickerId: attachment.stickerId }
            : { url: attachment.url },
        ],
  );
  const like = first.type === 'sticker' && LIKE_STICKER_IDS.has(first.stickerId ?? '');
  return {
    kind: first.type,
    text: like ? '👍' : '',
    details: { attachments: files },
  };
}

/** What the LLM reads for a message with no words; never shown to anyone. */
const CHAT_TAGS: Record<Exclude<MessageKind, 'text'>, string> = {
  sticker: '[sent a sticker]',
  reaction: '[reacted]',
  location: '[shared a location]',
  image: '[sent a photo]',
  video: '[sent a video]',
  audio: '[sent an audio clip]',
  file: '[sent a file]',
  share: '[shared a post]',
  other: '[sent an attachment]',
};

/** A message as the LLM's history reads it: its words, the 👍 sticker as 👍, anything else as a tag. */
export function chatText(message: { kind: MessageKind; text: string }): string {
  if (message.kind === 'text' || message.text) return message.text;
  return CHAT_TAGS[message.kind];
}

const EMOJI_PART = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
/** Pictographs, their modifiers and joiners, flags, keycaps and spaces; no letters or digits. */
const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3|\s)+$/u;

/** "👍", "❤️❤️", "🙏🏽": words for nobody to read, so no LLM call either. */
export function isEmojiOnly(text: string): boolean {
  return EMOJI_ONLY.test(text) && EMOJI_PART.test(text);
}
