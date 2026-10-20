import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
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
 * Settings > General, one row per shop, created on first save. Until then the
 * shop uses its default region. Name and logo are on Better Auth's organization
 * row. Codes are checked for shape only, since @app/shared holds the lists.
 * Every price and order is in `currency`; SettingsService decides when it may
 * change.
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
    /** Minor units; orders with a subtotal at or over it ship free. Null always charges. */
    freeDeliveryOver: integer('free_delivery_over'),
    /** Messenger's pre-chat greeting; null is the default for the shop's language. */
    messengerGreeting: text('messenger_greeting'),
    /** Up to 4 `{ kind, question }`, parsed with iceBreakerSchema on read; null is the defaults. */
    iceBreakers: jsonb('ice_breakers').$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('merchant_settings_country_ck', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check('merchant_settings_currency_ck', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('merchant_settings_date_format_ck', oneOf(t.dateFormat, DATE_FORMATS)),
    check('merchant_settings_contact_phone_ck', sql`${t.contactPhone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('merchant_settings_free_delivery_over_ck', sql`${t.freeDeliveryOver} >= 0`),
    merchantIsolation('merchant_settings_merchant_isolation', t.merchantId),
  ],
);

export type MerchantSettingsRow = typeof merchantSettings.$inferSelect;

/**
 * Settings > Notifications, one row per person per shop, written on their
 * first toggle: until then they read as @app/shared's NOTIFICATION_DEFAULTS,
 * which the repository also writes, so the columns carry no defaults of their
 * own. Per person because the email goes to a person; per shop because a
 * person can hold several.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    merchantId: merchantId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    newOrder: boolean('new_order').notNull(),
    customerWaiting: boolean('customer_waiting').notNull(),
    dailySummary: boolean('daily_summary').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'notification_preference_pk', columns: [t.merchantId, t.userId] }),
    // Deleting a user cascades here; the primary key leads with merchant_id.
    index('notification_preference_user_idx').on(t.userId),
    merchantIsolation('notification_preference_merchant_isolation', t.merchantId),
  ],
);

export type NotificationPreferenceRow = typeof notificationPreference.$inferSelect;

/** A literal copy of @app/shared's ASSISTANT_TONES; reply-phrasing.spec keeps them equal. */
export const ASSISTANT_TONE_VALUES = ['friendly', 'direct', 'formal'] as const;

/**
 * Settings > Order assistant, one row per shop, written on first save: until
 * then the shop reads as @app/shared's ASSISTANT_SETTINGS_DEFAULTS, which the
 * repository also writes, so the columns carry no defaults of their own.
 */
export const assistantSettings = pgTable(
  'assistant_settings',
  {
    merchantId: merchantId().primaryKey(),
    tone: text('tone', { enum: ASSISTANT_TONE_VALUES }).notNull(),
    /** `match`, or an ISO 639-1 code; ASSISTANT_LANGUAGES decides which are supported. */
    defaultLanguage: text('default_language').notNull(),
    /** The seller's own facts for customers; never prices or stock. */
    notes: text('notes').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('assistant_settings_tone_ck', oneOf(t.tone, ASSISTANT_TONE_VALUES)),
    check(
      'assistant_settings_default_language_ck',
      sql`${t.defaultLanguage} ~ '^([a-z]{2}|match)$'`,
    ),
    check('assistant_settings_notes_ck', sql`char_length(${t.notes}) <= 1000`),
    merchantIsolation('assistant_settings_merchant_isolation', t.merchantId),
  ],
);

export type AssistantSettingsRow = typeof assistantSettings.$inferSelect;
