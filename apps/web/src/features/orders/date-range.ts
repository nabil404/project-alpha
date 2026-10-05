import { TZDate } from '@date-fns/tz';
import { addDays, isValid, parseISO, startOfDay, startOfMonth } from 'date-fns';

/** The date filter's choices; `all` sets no bound. */
export const orderRanges = ['all', 'today', '7d', '30d', 'month', 'custom'] as const;
export type OrderRange = (typeof orderRanges)[number];

/** A calendar day as the date input gives it: "2026-10-05". */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface OrderRangeChoice {
  range: OrderRange;
  /** Custom only: the first day, inclusive. */
  from?: string;
  /** Custom only: the last day, inclusive. */
  to?: string;
}

/**
 * The instants the API filters on, from the seller's choice, in the shop's
 * time zone: "Today" is the shop's today wherever the seller is. Every bound
 * is the start of a day, so the result stays the same all day long and the
 * list's query key with it. `to` is exclusive, so a custom range ends at the
 * start of the day after its last.
 */
export function rangeInstants(
  { range, from, to }: OrderRangeChoice,
  timeZone: string,
  now: Date = new Date(),
): { from?: string; to?: string } {
  const today = startOfDay(new TZDate(now.getTime(), timeZone));
  const iso = (date: Date) => date.toISOString();
  switch (range) {
    case 'all':
      return {};
    case 'today':
      return { from: iso(today) };
    case '7d':
      return { from: iso(addDays(today, -6)) };
    case '30d':
      return { from: iso(addDays(today, -29)) };
    case 'month':
      return { from: iso(startOfMonth(today)) };
    case 'custom': {
      const day = (text: string | undefined) => {
        if (!text || !DAY_PATTERN.test(text)) return undefined;
        const parsed = parseISO(text);
        return isValid(parsed)
          ? new TZDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), timeZone)
          : undefined;
      };
      // A range typed backwards means the same days.
      const [start, end] = [day(from), day(to)].sort((a, b) =>
        a && b ? a.getTime() - b.getTime() : 0,
      );
      return {
        from: start && iso(start),
        to: end && iso(addDays(end, 1)),
      };
    }
  }
}
