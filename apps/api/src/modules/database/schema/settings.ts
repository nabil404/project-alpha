import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, merchantId, merchantIsolation, oneOf, updatedAt } from './columns';

/** A literal copy of @app/shared's DATE_FORMATS (drizzle-kit loads this file on its own); the schema spec keeps them equal. */
const DATE_FORMATS = [
  'd MMM yyyy',
  'MMM d, yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'dd.MM.yyyy',
  'yyyy-MM-dd',
] as const;

/**
 * Settings > General, one row per shop, written on the first save: until then
 * the shop reads as its default region. The shop's name and logo stay on
 * Better Auth's organization row.
 *
 * Codes are checked for shape only; which countries, currencies and zones
 * exist is @app/shared's to say, and changes with its data. `currency` is the
 * one every price and order of the shop is in - see SettingsService for when
 * it may change.
 */
export const merchantSettings = pgTable(
  'merchant_settings',
  {
    merchantId: merchantId().primaryKey(),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    timeZone: text('time_zone').notNull(),
    dateFormat: text('date_format', { enum: DATE_FORMATS }).notNull(),
    /** E.164. */
    contactPhone: text('contact_phone'),
    pickupAddress: text('pickup_address'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('merchant_settings_country_ck', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('merchant_settings_currency_ck', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('merchant_settings_date_format_ck', oneOf(t.dateFormat, DATE_FORMATS)),
    check('merchant_settings_contact_phone_ck', sql`${t.contactPhone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    merchantIsolation('merchant_settings_merchant_isolation', t.merchantId),
  ],
);

export type MerchantSettingsRow = typeof merchantSettings.$inferSelect;
