/**
 * The calendar year an order belongs to: the year at `placedAt` in the shop's
 * time zone, so an order placed just after midnight on 1 January in Dhaka
 * starts the new year's numbering even while it is still 31 December in UTC.
 */
export function orderYear(placedAt: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(placedAt));
}

/**
 * ORD-2026-00481: the year, then the shop's number within it, zero-padded to
 * five digits and never truncated past them. An identifier, not a quantity,
 * so it is never locale-grouped. Migration 0024 builds the same string in SQL.
 */
export function orderReference(year: number, number: number): string {
  return `ORD-${year}-${String(number).padStart(5, '0')}`;
}
