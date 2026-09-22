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

  return useMemo(() => ({ locale, formatMoney, formatDate }), [locale, formatMoney, formatDate]);
}

/**
 * Escape hatch for non-React callers (CSV export row builders, sort
 * comparators). Components must use useFormatters() instead — this one does not
 * re-render on a language change.
 */
export function currentLocale(): string {
  return i18n.language;
}
