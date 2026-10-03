import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';

/**
 * A phone number in E.164 (`+8801812000000`), checked against the number's
 * own country's numbering plan - length and prefixes, not just digit count.
 * The `max` metadata is what makes that check real; the smaller builds only
 * check length.
 *
 * Input may carry spaces, dashes and brackets as people type them; the output
 * is always the normalized E.164 string, so the database never holds two
 * spellings of one number.
 */
export const e164PhoneSchema = z
  .string()
  .trim()
  .min(1, { abort: true })
  .max(32, { abort: true })
  .transform((value, ctx) => {
    const parsed = value.startsWith('+') ? parsePhoneNumberFromString(value) : undefined;
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: 'custom', params: { code: 'INVALID_PHONE' } });
      return z.NEVER;
    }
    return parsed.number;
  });

/** Display form, international ("+880 1812-000000"); the input as given if it does not parse. */
export function formatPhoneInternational(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** The country a stored number belongs to, for preselecting the calling code picker. */
export function phoneCountryOf(e164: string): CountryCode | null {
  return parsePhoneNumberFromString(e164)?.country ?? null;
}
