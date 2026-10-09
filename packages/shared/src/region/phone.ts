import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
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

/** Bangla digits (০-৯) as Latin ones; everything else unchanged. */
export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
}

/**
 * A phone number a customer typed, as E.164, or null when it is not a real
 * number. A local number is read in the shop's country; one written with `+`
 * is read as written.
 */
export function parseCustomerPhone(text: string, country: string): string | null {
  const region: CountryCode | undefined = isSupportedCountry(country) ? country : undefined;
  const parsed = parsePhoneNumberFromString(toLatinDigits(text).trim(), region);
  return parsed?.isValid() ? parsed.number : null;
}

/** Every digit-only spelling of a stored number: E.164 without `+`, national, and national with its trunk prefix. */
export function phoneDigitForms(e164: string): string[] {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return [e164.replace(/\D/g, '')];
  return [
    ...new Set([
      parsed.number.replace(/\D/g, ''),
      parsed.nationalNumber,
      parsed.formatNational().replace(/\D/g, ''),
    ]),
  ];
}
