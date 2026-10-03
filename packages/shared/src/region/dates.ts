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
