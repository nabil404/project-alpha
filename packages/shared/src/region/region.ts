import { getCountry, getAllTimezones } from 'countries-and-timezones';
import { countries, type TCountryCode } from 'countries-list';
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';

/**
 * Where a shop trades: which countries, currencies and time zones the API
 * accepts, and the defaults picking a country suggests. Names are never
 * stored or sent - the dashboard localizes codes with Intl.DisplayNames - so
 * everything here is ISO codes and IANA ids, the same in every runtime.
 *
 * Sources: countries-list (country -> currency, languages, search aliases),
 * countries-and-timezones (country -> IANA zones), libphonenumber-js (calling
 * codes). Each fills the gaps the others leave; see each function.
 */

/**
 * Zones countries-and-timezones does not list for a country it does: Kosovo
 * shares Serbia's clock.
 */
const EXTRA_TIME_ZONES: Partial<Record<string, readonly string[]>> = {
  XK: ['Europe/Belgrade'],
};

/**
 * The zone a seller in a multi-zone country most likely means, where no zone
 * is named after the capital. Everywhere else the capital's zone, or the only
 * one, is the default.
 */
const DEFAULT_TIME_ZONE_OVERRIDES: Partial<Record<string, string>> = {
  AU: 'Australia/Sydney',
  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',
  CN: 'Asia/Shanghai',
  EC: 'America/Guayaquil',
  KI: 'Pacific/Tarawa',
  KZ: 'Asia/Almaty',
  MH: 'Pacific/Tarawa',
  MN: 'Asia/Ulaanbaatar',
  MY: 'Asia/Singapore',
  NZ: 'Pacific/Auckland',
  PF: 'Pacific/Tahiti',
  PS: 'Asia/Hebron',
  US: 'America/New_York',
  VN: 'Asia/Ho_Chi_Minh',
};

/**
 * Canonical IANA zones only: an alias like `Asia/Calcutta` is refused rather
 * than stored next to its canonical `Asia/Kolkata`. `UTC` is added for a seller
 * who wants no local time at all.
 */
export const TIME_ZONES: readonly string[] = [...Object.keys(getAllTimezones()), 'UTC'].sort();
const timeZoneSet: ReadonlySet<string> = new Set(TIME_ZONES);

function zonesOf(country: string): string[] {
  const zones = getCountry(country)?.timezones ?? EXTRA_TIME_ZONES[country] ?? [];
  return zones.filter((zone) => timeZoneSet.has(zone));
}

/**
 * Every country a shop can be in: one with a currency and a clock. Excludes
 * uninhabited territories (Antarctica, Bouvet Island) and the few
 * dependencies the time zone data has no entry for.
 */
export const COUNTRY_CODES: readonly string[] = (Object.keys(countries) as TCountryCode[])
  .filter((code) => countries[code].currency.length > 0 && zonesOf(code).length > 0)
  .sort();
const countrySet: ReadonlySet<string> = new Set(COUNTRY_CODES);

/**
 * The first currency each country lists is the one in everyday use; the rest
 * are fund or accounting codes (`USN`, `CHE`) nobody prices a kurti in. A
 * shop may sell in any of them, not only its own country's.
 */
export const CURRENCY_CODES: readonly string[] = [
  ...new Set(COUNTRY_CODES.map((code) => countries[code as TCountryCode].currency[0]!)),
].sort();
const currencySet: ReadonlySet<string> = new Set(CURRENCY_CODES);

export function isCountryCode(value: string): boolean {
  return countrySet.has(value);
}

export function isCurrencyCode(value: string): boolean {
  return currencySet.has(value);
}

export function isTimeZone(value: string): boolean {
  return timeZoneSet.has(value);
}

/** A country's zones, the default first; for listing them above the rest. */
export function timeZonesOf(country: string): string[] {
  const zones = zonesOf(country);
  const preferred = defaultTimeZone(country, zones);
  return preferred ? [preferred, ...zones.filter((zone) => zone !== preferred)] : zones;
}

function defaultTimeZone(country: string, zones: string[]): string | undefined {
  const override = DEFAULT_TIME_ZONE_OVERRIDES[country];
  if (override && zones.includes(override)) return override;
  const capital = countries[country as TCountryCode]?.capital.replaceAll(' ', '_');
  return zones.find((zone) => capital && zone.endsWith(`/${capital}`)) ?? zones[0];
}

/**
 * The international dialling code without the `+` ("880"), or null for the
 * handful of territories libphonenumber-js has no numbering plan for.
 */
export function callingCodeOf(country: string): string | null {
  const supported: readonly string[] = getCountries();
  return supported.includes(country) ? getCountryCallingCode(country as CountryCode) : null;
}

/**
 * Other names a seller might search the country picker by ("USA",
 * "East Pakistan"), besides its localized name.
 */
export function countryAliasesOf(country: string): string[] {
  const entry = countries[country as TCountryCode];
  return entry ? [entry.name, entry.native, ...(entry.alias ?? [])] : [];
}

/** ISO 639-1 codes of the country's languages, the most spoken first. */
export function languagesOf(country: string): string[] {
  return [...(countries[country as TCountryCode]?.languages ?? [])];
}

/**
 * How a shop's dates read. The values are date-fns patterns, rendered by
 * formatShopDate; the database keeps a literal copy of this list.
 */
export const DATE_FORMATS = [
  'd MMM yyyy', // 27 Sep 2026
  'MMM d, yyyy', // Sep 27, 2026
  'dd/MM/yyyy', // 27/09/2026
  'MM/dd/yyyy', // 09/27/2026
  'dd.MM.yyyy', // 27.09.2026
  'yyyy-MM-dd', // 2026-09-27
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * Which way round the country writes a date, read from CLDR through Intl in
 * the country's own main language - `en-BD` would fall back to US order.
 */
function defaultDateFormat(country: string): DateFormat {
  const language = languagesOf(country)[0] ?? 'en';
  let first: string | undefined;
  try {
    first = new Intl.DateTimeFormat(`${language}-${country}`, { dateStyle: 'short' })
      .formatToParts(new Date(Date.UTC(2026, 8, 27)))
      .find((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')?.type;
  } catch {
    first = undefined;
  }
  if (first === 'year') return 'yyyy-MM-dd';
  if (first === 'month') return 'MMM d, yyyy';
  return 'd MMM yyyy';
}

export interface RegionDefaults {
  currency: string;
  timeZone: string;
  dateFormat: DateFormat;
  /** Without the `+`; null where there is no numbering plan. */
  callingCode: string | null;
}

/**
 * What choosing a country fills in. The seller can change each afterwards;
 * the dashboard applies these when the country changes, and the API uses them
 * for a shop that has never saved its region.
 */
export function regionDefaults(country: string): RegionDefaults {
  const entry = countries[country as TCountryCode];
  const timeZone = timeZonesOf(country)[0];
  if (!entry || !isCountryCode(country) || !timeZone) {
    throw new Error(`regionDefaults: unsupported country ${country}`);
  }
  return {
    currency: entry.currency[0]!,
    timeZone,
    dateFormat: defaultDateFormat(country),
    callingCode: callingCodeOf(country),
  };
}

/** Where a shop starts before its seller picks a region: the MVP's first market. */
export const DEFAULT_COUNTRY = 'BD';
