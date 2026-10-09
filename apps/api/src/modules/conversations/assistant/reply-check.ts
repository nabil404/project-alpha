import { phoneDigitForms, toLatinDigits } from '@app/shared';
import type { ReplyFacts } from './reply-intent';

export const REPLY_MAX_GRAPHEMES = 500;

export type ReplyCheck =
  { ok: true } | { ok: false; reason: 'empty' | 'too_long' | 'url' | 'number' };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const URL_LIKE =
  /(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+\.(?:com|net|org|info|biz|io|co|me|app|shop|store|xyz|link|ly|bd|in|uk)\b/iu;

/**
 * Digit runs, read the way a number is: "1,600", "01812-000000" and
 * "+880 1812" each become one run. Bangla digits count as digits.
 */
function digitRuns(text: string): string[] {
  return (
    toLatinDigits(text)
      // A zero fraction says nothing: "1,600.00" and "1600" are the same price.
      .replace(/(\d)\.0+(?!\d)/g, '$1')
      .replace(/(\d)[\s,.-](?=\d)/g, '$1')
      .match(/\d+/g) ?? []
  );
}

/** Every number the facts hold, as the digit runs a reply may write it with. */
function allowedRuns(value: unknown, key = ''): string[] {
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return key === 'phone' ? phoneDigitForms(value) : digitRuns(value);
  if (Array.isArray(value)) return value.flatMap((entry) => allowedRuns(entry));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([field, entry]) => allowedRuns(entry, field));
  }
  return [];
}

/**
 * Code's last word on a phrased reply: every number in it must come from the
 * facts, it carries no link, and it fits. Anything else is replaced by the
 * fixed fallback sentence.
 */
export function checkReply(text: string, facts: ReplyFacts): ReplyCheck {
  const reply = text.trim();
  if (reply === '') return { ok: false, reason: 'empty' };
  if (Array.from(graphemes.segment(reply)).length > REPLY_MAX_GRAPHEMES) {
    return { ok: false, reason: 'too_long' };
  }
  if (URL_LIKE.test(reply)) return { ok: false, reason: 'url' };

  const allowed = new Set(allowedRuns(facts));
  return digitRuns(reply).every((run) => allowed.has(run))
    ? { ok: true }
    : { ok: false, reason: 'number' };
}
