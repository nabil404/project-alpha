/** The daily summary goes out at this shop-local hour. */
export const DAILY_SUMMARY_HOUR = 9;
/** Minutes between scans; every UTC offset is a multiple of it, so each shop hits 9:00 on one scan. */
export const DAILY_SUMMARY_SCAN_MINUTES = 15;

export interface ShopClock {
  /** The shop-local calendar day, yyyy-MM-dd. */
  day: string;
  hour: number;
  minute: number;
}

/** What the wall clock reads in `timeZone` at `now`. */
export function shopClock(now: Date, timeZone: string): ShopClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  };
}

/**
 * The day to summarise if this scan is the shop's 9:00 one - yesterday,
 * shop time - else null. A scan runs every DAILY_SUMMARY_SCAN_MINUTES, so
 * exactly one a day falls in [9:00, 9:15).
 */
export function dailySummaryDayDue(now: Date, timeZone: string): string | null {
  const clock = shopClock(now, timeZone);
  if (clock.hour !== DAILY_SUMMARY_HOUR || clock.minute >= DAILY_SUMMARY_SCAN_MINUTES) return null;
  return previousDay(clock.day);
}

/** The calendar day before a yyyy-MM-dd day. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}
