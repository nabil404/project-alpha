import { useMemo } from 'react';
import {
  callingCodeOf,
  COUNTRY_CODES,
  countryAliasesOf,
  CURRENCY_CODES,
  TIME_ZONES,
  timeZonesOf,
} from '@app/shared';

import type { ComboboxOption } from '@/components/ui/combobox';
import { useFormatters } from '@/lib/format';

/**
 * Picker options for Settings > General. Names come from Intl in the
 * dashboard's language - nothing here is translated by hand - and each option
 * keeps its code as the value the API takes.
 */

function displayNames(locale: string, type: Intl.DisplayNamesType): Intl.DisplayNames {
  return new Intl.DisplayNames([locale, 'en'], { type, fallback: 'code' });
}

/** "🇧🇩" from "BD": regional indicator symbols, which every current OS draws as a flag. */
export function flagOf(country: string): string {
  return String.fromCodePoint(...[...country].map((char) => 0x1f1a5 + char.charCodeAt(0)));
}

export function useCountryName(): (country: string) => string {
  const { locale } = useFormatters();
  return useMemo(() => {
    const names = displayNames(locale, 'region');
    return (country: string) => names.of(country) ?? country;
  }, [locale]);
}

/** Every country, by its name in the dashboard's language; searchable by its other names too. */
export function useCountryOptions(): ComboboxOption[] {
  const { locale } = useFormatters();
  return useMemo(() => {
    const names = displayNames(locale, 'region');
    return COUNTRY_CODES.map((code) => ({
      value: code,
      label: names.of(code) ?? code,
      prefix: flagOf(code),
      keywords: [code, ...countryAliasesOf(code)],
    })).sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [locale]);
}

/** "Bangladeshi Taka (BDT, ৳)": the name, the code, and the symbol when it differs. */
export function useCurrencyOptions(): ComboboxOption[] {
  const { locale, currencySymbol } = useFormatters();
  return useMemo(() => {
    const names = displayNames(locale, 'currency');
    return CURRENCY_CODES.map((code) => {
      const symbol = currencySymbol(code);
      const name = names.of(code) ?? code;
      return {
        value: code,
        label: symbol === code ? `${name} (${code})` : `${name} (${code}, ${symbol})`,
        keywords: [code, symbol],
      };
    }).sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [locale, currencySymbol]);
}

function offsetLabel(locale: string, timeZone: string, now: Date): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

export interface TimeZoneOptions {
  /** The country's own zones, its default first. */
  local: ComboboxOption[];
  /** Every other zone, by id. */
  other: ComboboxOption[];
}

/** "Asia/Dhaka (GMT+6)", with the offset as it is today, DST included. */
export function useTimeZoneOptions(country: string): TimeZoneOptions {
  const { locale } = useFormatters();
  return useMemo(() => {
    const now = new Date();
    const option = (zone: string): ComboboxOption => {
      const offset = offsetLabel(locale, zone, now);
      return {
        value: zone,
        label: offset ? `${zone.replaceAll('_', ' ')} (${offset})` : zone,
        keywords: [zone, offset],
      };
    };
    const localZones = timeZonesOf(country);
    const localSet = new Set(localZones);
    return {
      local: localZones.map(option),
      other: TIME_ZONES.filter((zone) => !localSet.has(zone)).map(option),
    };
  }, [locale, country]);
}

/** "🇧🇩 +880" per country that has a numbering plan, for the phone field's code picker. */
export function useCallingCodeOptions(): ComboboxOption[] {
  const countries = useCountryOptions();
  return useMemo(
    () =>
      countries.flatMap((country) => {
        const code = callingCodeOf(country.value);
        return code
          ? [
              {
                value: country.value,
                label: `${country.label} +${code}`,
                prefix: country.prefix,
                keywords: [...(country.keywords ?? []), `+${code}`, code],
                display: `+${code}`,
              },
            ]
          : [];
      }),
    [countries],
  );
}

/** A language in its own words ("English", "বাংলা"), as people look for their own. */
export function nativeLanguageName(language: string): string {
  return new Intl.DisplayNames([language, 'en'], { type: 'language' }).of(language) ?? language;
}
