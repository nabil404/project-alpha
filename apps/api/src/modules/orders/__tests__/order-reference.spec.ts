import { orderReference, orderYear } from '../order-reference';

describe('orderYear', () => {
  it("reads the year in the shop's time zone, not UTC", () => {
    // 23:30 on 31 December in Dhaka (UTC+6).
    expect(orderYear(new Date('2026-12-31T17:30:00Z'), 'Asia/Dhaka')).toBe(2026);
    // 00:30 on 1 January in Dhaka, still 31 December in UTC.
    expect(orderYear(new Date('2026-12-31T18:30:00Z'), 'Asia/Dhaka')).toBe(2027);
    // The same instant is still the old year in New York.
    expect(orderYear(new Date('2026-12-31T18:30:00Z'), 'America/New_York')).toBe(2026);
  });
});

describe('orderReference', () => {
  it('pads the number to five digits after the year', () => {
    expect(orderReference(2026, 1)).toBe('ORD-2026-00001');
    expect(orderReference(2027, 481)).toBe('ORD-2027-00481');
    expect(orderReference(2026, 99999)).toBe('ORD-2026-99999');
  });

  it('widens past 99999 instead of truncating', () => {
    expect(orderReference(2026, 100000)).toBe('ORD-2026-100000');
  });
});
