import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TZDate } from '@date-fns/tz';
import { differenceInCalendarDays, format, type Locale } from 'date-fns';
import { enGB, enUS } from 'date-fns/locale';
import {
  formatMinorUnits,
  formatMinorUnitsAmount,
  type DateFormat,
  type MinorUnits,
} from '@app/shared';

import i18n from '@/i18n';
import { useShopRegion } from '@/lib/shop-region';

/**
 * Named presets rather than raw patterns at call sites, so every date in the
 * dashboard renders the same way. `date` is the shop's chosen format; the
 * shorter ones keep its day/month order. `p` is date-fns' localized time
 * ("8:05 PM", "20:05").
 */
export type DatePreset = 'date' | 'dayMonth' | 'monthYear' | 'dateTime' | 'time';

const MONTH_FIRST: ReadonlySet<DateFormat> = new Set(['MMM d, yyyy', 'MM/dd/yyyy']);

function datePattern(preset: DatePreset, dateFormat: DateFormat): string {
  switch (preset) {
    case 'date':
      return dateFormat;
    case 'dayMonth':
      return MONTH_FIRST.has(dateFormat) || dateFormat === 'yyyy-MM-dd' ? 'MMM d' : 'd MMM';
    case 'monthYear':
      return 'MMM yyyy';
    case 'dateTime':
      return `${dateFormat}, p`;
    case 'time':
      return 'p';
  }
}

/**
 * date-fns locales for month names and the time format, by the dashboard's
 * language tag. Only the ones a shipped translation can produce are bundled;
 * add one with its locale files.
 */
const DATE_FNS_LOCALES: Readonly<Record<string, Locale>> = {
  en: enUS,
  'en-US': enUS,
  'en-GB': enGB,
};

export function dateFnsLocale(tag: string): Locale {
  return DATE_FNS_LOCALES[tag] ?? DATE_FNS_LOCALES[tag.split('-')[0] ?? ''] ?? enUS;
}

/**
 * The language tag as Intl will take it. A browser can report one Intl
 * rejects - a POSIX locale comes through as 'en-US@posix' - and every
 * formatter would throw on it; the part before '@' is tried, then English.
 */
export function intlLocale(tag: string): string {
  for (const candidate of [tag, tag.split('@')[0] ?? '']) {
    try {
      const [canonical] = Intl.getCanonicalLocales(candidate);
      if (canonical) return canonical;
    } catch {
      // not a BCP-47 tag; try the next
    }
  }
  return 'en';
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

/**
 * The seam between i18next's active language, the shop's region and the
 * framework-agnostic helpers in @app/shared — which must never import i18next
 * themselves, so the locale crosses that boundary as a plain BCP-47 string.
 * Components use this so a language or region change re-renders every
 * formatted value.
 *
 * Money defaults to the shop's currency and dates to the shop's time zone and
 * format: the same order reads the same on a laptop in Dhaka and one abroad.
 */
export function useFormatters() {
  const { i18n: instance } = useTranslation();
  // The full tag with region ('en-GB'), not resolvedLanguage — Intl wants the
  // region to pick currency and date conventions.
  const locale = intlLocale(instance.language);
  const { currency: shopCurrency, timeZone, dateFormat } = useShopRegion();

  const formatMoney = useCallback(
    (amount: MinorUnits, currency: string = shopCurrency): string =>
      formatMinorUnits(amount, currency, locale),
    [locale, shopCurrency],
  );

  /** Without the currency, for a table whose header names it ("Price (৳)"). */
  const formatAmount = useCallback(
    (amount: MinorUnits, currency: string = shopCurrency): string =>
      formatMinorUnitsAmount(amount, currency, locale),
    [locale, shopCurrency],
  );

  const formatDate = useCallback(
    (value: Date | string | number, preset: DatePreset = 'date'): string =>
      format(new TZDate(new Date(value).getTime(), timeZone), datePattern(preset, dateFormat), {
        locale: dateFnsLocale(locale),
      }),
    [locale, timeZone, dateFormat],
  );

  /** Calendar days from `now` to `value` in the shop's zone: 0 today, -1 yesterday. */
  const dayOffset = useCallback(
    (value: Date | string | number, now: Date = new Date()): number =>
      differenceInCalendarDays(
        new TZDate(new Date(value).getTime(), timeZone),
        new TZDate(now.getTime(), timeZone),
      ),
    [timeZone],
  );

  /** Whether two instants fall on the same day in the shop's zone. */
  const isSameDay = useCallback(
    (a: Date | string | number, b: Date | string | number = new Date()): boolean =>
      dayOffset(a, new Date(b)) === 0,
    [dayOffset],
  );

  /** "today", "yesterday", "3 days ago" — for values only accurate to the day. */
  const formatRelativeDay = useCallback(
    (value: Date | string | number, now: Date = new Date()): string =>
      relativeTimeFormatter(locale).format(dayOffset(value, now), 'day'),
    [locale, dayOffset],
  );

  /** "৳" for BDT: the prefix inside an amount field. */
  const currencySymbol = useCallback(
    (currency: string = shopCurrency): string =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency,
    [locale, shopCurrency],
  );

  /** A count with the locale's grouping: "1,284". */
  const formatNumber = useCallback(
    (value: number): string => new Intl.NumberFormat(locale).format(value),
    [locale],
  );

  /** A fraction as a whole percentage: 0.38 → "38%"; `signed` writes "+4%" and "-4%". */
  const formatPercent = useCallback(
    (fraction: number, { signed = false }: { signed?: boolean } = {}): string =>
      new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 0,
        signDisplay: signed ? 'exceptZero' : 'auto',
      }).format(fraction),
    [locale],
  );

  /** "Blue kurti × 2, Dupatta × 1": a short list of things, no "and". */
  const formatList = useCallback(
    (items: string[]): string =>
      new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(items),
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
    () => ({
      locale,
      formatMoney,
      formatAmount,
      formatDate,
      formatRelativeDay,
      dayOffset,
      isSameDay,
      currencySymbol,
      formatFileSize,
      formatNumber,
      formatPercent,
      formatList,
    }),
    [
      locale,
      formatMoney,
      formatAmount,
      formatDate,
      formatRelativeDay,
      dayOffset,
      isSameDay,
      currencySymbol,
      formatFileSize,
      formatNumber,
      formatPercent,
      formatList,
    ],
  );
}

/**
 * Escape hatch for non-React callers (CSV export row builders, sort
 * comparators). Components must use useFormatters() instead — this one does not
 * re-render on a language change.
 */
export function currentLocale(): string {
  return intlLocale(i18n.language);
}
