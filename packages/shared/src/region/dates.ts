import { TZDate } from '@date-fns/tz';
import { format, type Locale } from 'date-fns';
import type { DateFormat } from './region';

export interface ShopDateOptions {
  dateFormat: DateFormat;
  /** IANA zone the date is read in: the shop's, not the viewer's browser. */
  timeZone: string;
  /**
   * date-fns locale for month names ("Sep", "সেপ্টেম্বর"). The caller passes
   * the one matching the dashboard language, so this package never loads them all.
   */
  locale?: Locale;
}

/**
 * A calendar date in the shop's format and time zone. The same instant is a
 * different day in Dhaka and New York, so the zone is never left to the
 * viewer's machine.
 */
export function formatShopDate(
  value: Date | string | number,
  { dateFormat, timeZone, locale }: ShopDateOptions,
): string {
  const instant = new Date(value).getTime();
  return format(new TZDate(instant, timeZone), dateFormat, locale ? { locale } : {});
}

/** The shop's calendar day at `now`, as `yyyy-MM-dd`. */
export function shopToday(timeZone: string, now: Date = new Date()): string {
  return format(new TZDate(now.getTime(), timeZone), 'yyyy-MM-dd');
}

/** The instant a shop-local day (`yyyy-MM-dd`) begins in the shop's zone. */
export function shopDayStart(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(year, month - 1, date, timeZone).getTime());
}
