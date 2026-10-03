import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  TIME_ZONES,
  callingCodeOf,
  countryAliasesOf,
  defaultDashboardLocale,
  formatMinorUnits,
  formatShopDate,
  minorUnitsPerMajor,
  regionDefaults,
  timeZonesOf,
  updateGeneralSettingsSchema,
} from '@app/shared';
import { rescaleFactor } from '../general-settings.service';

describe('region data', () => {
  it('offers every inhabited country, and every listed one has full defaults', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(COUNTRY_CODES).not.toContain('AQ');
    for (const country of COUNTRY_CODES) {
      const defaults = regionDefaults(country);
      expect(CURRENCY_CODES).toContain(defaults.currency);
      expect(TIME_ZONES).toContain(defaults.timeZone);
    }
  });

  it.each([
    ['BD', 'BDT', 'Asia/Dhaka', 'd MMM yyyy', '880'],
    ['US', 'USD', 'America/New_York', 'MMM d, yyyy', '1'],
    ['IN', 'INR', 'Asia/Kolkata', 'd MMM yyyy', '91'],
    ['JP', 'JPY', 'Asia/Tokyo', 'yyyy-MM-dd', '81'],
    ['GB', 'GBP', 'Europe/London', 'd MMM yyyy', '44'],
    ['XK', 'EUR', 'Europe/Belgrade', 'd MMM yyyy', '383'],
  ])('suggests the right defaults for %s', (country, currency, timeZone, dateFormat, code) => {
    expect(regionDefaults(country)).toEqual({
      currency,
      timeZone,
      dateFormat,
      callingCode: code,
    });
  });

  it("lists a country's own zones with the default first", () => {
    const zones = timeZonesOf('US');
    expect(zones[0]).toBe('America/New_York');
    expect(zones).toContain('America/Los_Angeles');
  });

  it('keeps fund codes like USN out of the currency list', () => {
    expect(CURRENCY_CODES).toContain('USD');
    expect(CURRENCY_CODES).not.toContain('USN');
    expect(CURRENCY_CODES).not.toContain('CHE');
  });

  it('has no calling code for a territory without a numbering plan', () => {
    expect(callingCodeOf('BD')).toBe('880');
    expect(callingCodeOf('PN')).toBeNull();
  });

  it('finds a country by its other names', () => {
    expect(countryAliasesOf('US')).toEqual(expect.arrayContaining(['USA', 'United States']));
  });

  it('falls back to English for a language the dashboard has no translation for', () => {
    expect(defaultDashboardLocale('BD')).toBe('en');
    expect(defaultDashboardLocale('GB')).toBe('en');
  });
});

describe('updateGeneralSettingsSchema', () => {
  it('normalizes a phone number to E.164', () => {
    expect(updateGeneralSettingsSchema.parse({ contactPhone: '+880 1812-000000' })).toEqual({
      contactPhone: '+8801812000000',
    });
  });

  it.each([
    ['a number too short for its country', '+880 1812'],
    ['a national number without its country code', '01812-000000'],
    ['letters', '+880 ABC'],
  ])('refuses %s', (_, contactPhone) => {
    const result = updateGeneralSettingsSchema.safeParse({ contactPhone });
    expect(result.error?.issues[0]).toMatchObject({ params: { code: 'INVALID_PHONE' } });
  });

  it('clears the phone and address when sent blank', () => {
    expect(updateGeneralSettingsSchema.parse({ contactPhone: '', pickupAddress: '  ' })).toEqual({
      contactPhone: null,
      pickupAddress: null,
    });
  });

  it.each([
    ['country', 'ZZ'],
    ['currency', 'USN'],
    ['timeZone', 'Asia/Calcutta'],
    ['timeZone', 'Mars/Olympus'],
  ])('refuses an unknown %s %s', (field, value) => {
    const result = updateGeneralSettingsSchema.safeParse({ [field]: value });
    expect(result.error?.issues[0]).toMatchObject({
      path: [field],
      params: { code: 'INVALID_INPUT' },
    });
  });

  it('refuses a date format it does not know and a field it does not take', () => {
    expect(updateGeneralSettingsSchema.safeParse({ dateFormat: 'yyyy' }).success).toBe(false);
    expect(updateGeneralSettingsSchema.safeParse({ logo: 'x' }).success).toBe(false);
  });
});

describe('formatShopDate', () => {
  const lateEvening = '2026-09-27T20:00:00Z';

  it("reads the date in the shop's zone, not the machine's", () => {
    expect(formatShopDate(lateEvening, { dateFormat: 'd MMM yyyy', timeZone: 'Asia/Dhaka' })).toBe(
      '28 Sep 2026',
    );
    expect(
      formatShopDate(lateEvening, { dateFormat: 'MM/dd/yyyy', timeZone: 'America/New_York' }),
    ).toBe('09/27/2026');
  });
});

describe('currency decimals', () => {
  it("formats minor units with the currency's own exponent", () => {
    expect(minorUnitsPerMajor('BDT')).toBe(100);
    expect(minorUnitsPerMajor('JPY')).toBe(1);
    expect(minorUnitsPerMajor('KWD')).toBe(1000);
    expect(formatMinorUnits(1600, 'JPY')).toBe('¥1,600');
  });

  it.each([
    ['BDT', 'INR', null],
    ['JPY', 'BDT', '100'],
    ['BDT', 'JPY', '0.01'],
    ['JPY', 'KWD', '1000'],
    ['KWD', 'JPY', '0.001'],
  ])('rescales %s to %s by %s', (from, to, factor) => {
    expect(rescaleFactor(from, to)).toBe(factor);
  });
});
