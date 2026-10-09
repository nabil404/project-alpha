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
      .replace(/(\d)[\s,.-](?=\d)/g, '$1')
      .match(/\d+/g) ?? []
  );
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

  const allowed = new Set([
    ...[facts.productText, facts.variantText, facts.customerName, facts.deliveryAddress]
      .filter((value): value is string => value !== undefined)
      .flatMap(digitRuns),
    ...(facts.quantity === undefined ? [] : [String(facts.quantity)]),
    ...(facts.phone === undefined ? [] : phoneDigitForms(facts.phone)),
  ]);
  return digitRuns(reply).every((run) => allowed.has(run))
    ? { ok: true }
    : { ok: false, reason: 'number' };
}
