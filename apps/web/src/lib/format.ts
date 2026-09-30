import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMinorUnits, type MinorUnits } from '@app/shared';

import i18n from '@/i18n';

/**
 * Named presets rather than raw Intl options at call sites, so every date in
 * the dashboard renders the same way.
 */
const DATE_PRESETS = {
  date: { dateStyle: 'medium' },
  dayMonth: { month: 'short', day: 'numeric' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DatePreset = keyof typeof DATE_PRESETS;

// Constructing an Intl formatter is the expensive part; the format call is not.
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(locale: string, preset: DatePreset): Intl.DateTimeFormat {
  const cacheKey = `${locale}:${preset}`;
  const cached = dateTimeFormatters.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(locale, DATE_PRESETS[preset]);
  dateTimeFormatters.set(cacheKey, formatter);
  return formatter;
}

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeTimeFormatter(locale: string): Intl.RelativeTimeFormat {
  const cached = relativeTimeFormatters.get(locale);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  relativeTimeFormatters.set(locale, formatter);
  return formatter;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight, so "yesterday" means the calendar day, not 24 hours ago. */
function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/**
 * The seam between i18next's active language and the framework-agnostic Intl
 * helpers in @app/shared — which must never import i18next themselves, so the
 * locale crosses that boundary as a plain BCP-47 string. Components use this so
 * a language change re-renders every formatted value.
 */
export function useFormatters() {
  const { i18n: instance } = useTranslation();
  // The full tag with region ('en-GB'), not resolvedLanguage — Intl wants the
  // region to pick currency and date conventions.
  const locale = instance.language;

  const formatMoney = useCallback(
    (amount: MinorUnits, currency: string): string => formatMinorUnits(amount, currency, locale),
    [locale],
  );

  const formatDate = useCallback(
    (value: Date | string | number, preset: DatePreset = 'date'): string =>
      dateTimeFormatter(locale, preset).format(new Date(value)),
    [locale],
  );

  /** "today", "yesterday", "3 days ago" — for values only accurate to the day. */
  const formatRelativeDay = useCallback(
    (value: Date | string | number, now: Date = new Date()): string => {
      // Rounded: a DST change makes one calendar day 23 or 25 hours long.
      const days = Math.round((startOfDay(new Date(value)) - startOfDay(now)) / DAY_MS);
      return relativeTimeFormatter(locale).format(days, 'day');
    },
    [locale],
  );

  /** "৳" for BDT: the prefix inside an amount field. */
  const currencySymbol = useCallback(
    (currency: string): string =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency,
    [locale],
  );

  /** "1.6 MB", or "240 kB" under a megabyte: a file's size for the seller, not a byte count. */
  const formatFileSize = useCallback(
    (bytes: number): string => {
      const megabytes = bytes / 1_000_000;
      const [value, unit] = megabytes >= 1 ? [megabytes, 'megabyte'] : [bytes / 1000, 'kilobyte'];
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        maximumFractionDigits: 1,
      }).format(value);
    },
    [locale],
  );

  return useMemo(
    () => ({ locale, formatMoney, formatDate, formatRelativeDay, currencySymbol, formatFileSize }),
    [locale, formatMoney, formatDate, formatRelativeDay, currencySymbol, formatFileSize],
  );
}

/**
 * Escape hatch for non-React callers (CSV export row builders, sort
 * comparators). Components must use useFormatters() instead — this one does not
 * re-render on a language change.
 */
export function currentLocale(): string {
  return i18n.language;
}
