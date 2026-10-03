import { z } from 'zod';
import { e164PhoneSchema } from '../region/phone';
import {
  DATE_FORMATS,
  isCountryCode,
  isCurrencyCode,
  isTimeZone,
  languagesOf,
} from '../region/region';
import { AVATAR_ACCEPTED_TYPES, AVATAR_MAX_BYTES, AVATAR_MIN_SIDE } from './account';
import { NAME_MAX_LENGTH } from './auth';

/**
 * Settings > General: the shop's profile and region. The shop name and logo
 * live on the organization; the rest is the shop's settings row.
 */

export const PICKUP_ADDRESS_MAX_LENGTH = 500;

/** A blank field clears the value. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );

const code = (valid: (value: string) => boolean) =>
  z.string().refine(valid, { params: { code: 'INVALID_INPUT' } });

export const countryCodeSchema = code(isCountryCode);
export const currencyCodeSchema = code(isCurrencyCode);
export const timeZoneSchema = code(isTimeZone);
export const dateFormatSchema = z.enum(DATE_FORMATS);

/** GET and PATCH /settings/general. */
export const generalSettingsSchema = z.object({
  name: z.string(),
  /** Null until the seller uploads one. */
  logo: z.string().nullable(),
  /** E.164, e.g. "+8801812000000". */
  contactPhone: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  /** ISO 3166-1 alpha-2. */
  country: z.string(),
  /** ISO 4217. */
  currency: z.string(),
  /** IANA zone id. */
  timeZone: z.string(),
  dateFormat: dateFormatSchema,
  /**
   * True once the shop has taken an order: from then on the currency is
   * fixed, because every order and price is stored in it.
   */
  currencyLocked: z.boolean(),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

/**
 * PATCH /settings/general. Omit a field to leave it alone. Changing the
 * currency while unlocked keeps every price's number the same in the new
 * currency - nothing is converted.
 */
export const updateGeneralSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH).optional(),
    contactPhone: clearable(e164PhoneSchema).optional(),
    pickupAddress: clearable(z.string().trim().max(PICKUP_ADDRESS_MAX_LENGTH)).optional(),
    country: countryCodeSchema.optional(),
    currency: currencyCodeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    dateFormat: dateFormatSchema.optional(),
  })
  .strict();
export type UpdateGeneralSettings = z.infer<typeof updateGeneralSettingsSchema>;
export type UpdateGeneralSettingsInput = z.input<typeof updateGeneralSettingsSchema>;

/** The logo takes the same images as a profile photo, published the same way. */
export const LOGO_MAX_BYTES = AVATAR_MAX_BYTES;
export const LOGO_MIN_SIDE = AVATAR_MIN_SIDE;
export const LOGO_ACCEPTED_TYPES = AVATAR_ACCEPTED_TYPES;

/** PUT and DELETE /settings/general/logo. `null` once the logo is removed. */
export const shopLogoSchema = z.object({
  logo: z.string().nullable(),
});
export type ShopLogo = z.infer<typeof shopLogoSchema>;

/**
 * Languages the dashboard has a translation for. Add one here only together
 * with its locale files in apps/web.
 */
export const DASHBOARD_LOCALES = ['en'] as const;
export const dashboardLocaleSchema = z.enum(DASHBOARD_LOCALES);
export type DashboardLocale = z.infer<typeof dashboardLocaleSchema>;

/**
 * A seller who has not picked a language gets the first of their shop's
 * country's languages the dashboard speaks, else English.
 */
export function defaultDashboardLocale(country: string): DashboardLocale {
  const supported: readonly string[] = DASHBOARD_LOCALES;
  const match = languagesOf(country).find((language) => supported.includes(language));
  return (match as DashboardLocale | undefined) ?? 'en';
}

/**
 * PATCH /account/preferences: the signed-in person's own choices, not the
 * shop's. `null` returns the language to the shop's default.
 */
export const updateAccountPreferencesSchema = z
  .object({
    locale: dashboardLocaleSchema.nullable(),
  })
  .strict();
export type UpdateAccountPreferences = z.infer<typeof updateAccountPreferencesSchema>;

export const accountPreferencesSchema = z.object({
  /** Null: follow the shop's country. */
  locale: dashboardLocaleSchema.nullable(),
});
export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
