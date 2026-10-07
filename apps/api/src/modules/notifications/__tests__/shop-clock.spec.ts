import { dailySummaryDayDue, previousDay, shopClock } from '../shop-clock';

describe('shopClock', () => {
  it('reads the wall clock in the shop zone, not the server one', () => {
    const now = new Date('2026-10-07T03:05:00Z');
    expect(shopClock(now, 'Asia/Dhaka')).toEqual({ day: '2026-10-07', hour: 9, minute: 5 });
    expect(shopClock(now, 'America/New_York')).toEqual({ day: '2026-10-06', hour: 23, minute: 5 });
  });

  it('reads midnight as hour 0', () => {
    expect(shopClock(new Date('2026-10-07T00:00:00Z'), 'UTC').hour).toBe(0);
  });
});

describe('dailySummaryDayDue', () => {
  it("is yesterday on the shop's 9:00 scan", () => {
    expect(dailySummaryDayDue(new Date('2026-10-07T03:00:00Z'), 'Asia/Dhaka')).toBe('2026-10-06');
    expect(dailySummaryDayDue(new Date('2026-10-07T03:14:59Z'), 'Asia/Dhaka')).toBe('2026-10-06');
  });

  it('is null on every other scan', () => {
    expect(dailySummaryDayDue(new Date('2026-10-07T02:45:00Z'), 'Asia/Dhaka')).toBeNull();
    expect(dailySummaryDayDue(new Date('2026-10-07T03:15:00Z'), 'Asia/Dhaka')).toBeNull();
  });

  it('finds 9:00 in a zone with a 45-minute offset', () => {
    // Kathmandu is UTC+5:45, so 9:00 there is 03:15 UTC.
    expect(dailySummaryDayDue(new Date('2026-10-07T03:15:00Z'), 'Asia/Kathmandu')).toBe(
      '2026-10-06',
    );
  });

  it('follows daylight saving time', () => {
    // New York is UTC-4 in summer and UTC-5 in winter.
    expect(dailySummaryDayDue(new Date('2026-07-01T13:00:00Z'), 'America/New_York')).toBe(
      '2026-06-30',
    );
    expect(dailySummaryDayDue(new Date('2026-12-01T14:00:00Z'), 'America/New_York')).toBe(
      '2026-11-30',
    );
  });
});

describe('previousDay', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});
