import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { boolean, pgPolicy, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { organization } from './auth';

/** Constraint names the Page service maps unique violations from. */
export const FACEBOOK_PAGE_PAGE_ID_UQ = 'facebook_page_page_id_uq';
export const FACEBOOK_PAGE_MERCHANT_UQ = 'facebook_page_merchant_uq';

/**
 * The seller's connected Facebook Page.
 *
 * `page_id` is unique globally, not per merchant - the one deliberate
 * exception to "every uniqueness rule includes merchant_id". The webhook
 * resolves Page -> merchant with no session to go on, so a Page two shops had
 * both claimed would have no resolvable owner.
 *
 * `merchant_id` is unique too: the MVP connects one Page per shop.
 *
 * `access_token` holds CryptoService ciphertext, never the token itself.
 */
export const facebookPage = pgTable(
  'facebook_page',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => organization.id),
    pageId: text('page_id').notNull(),
    name: text('name').notNull(),
    accessToken: text('access_token').notNull(),
    botEnabled: boolean('bot_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique('facebook_page_merchant_id_uq').on(t.merchantId, t.id),
    unique(FACEBOOK_PAGE_PAGE_ID_UQ).on(t.pageId),
    unique(FACEBOOK_PAGE_MERCHANT_UQ).on(t.merchantId),
    pgPolicy('facebook_page_merchant_isolation', {
      for: 'all',
      using: sql`${t.merchantId} = app_current_merchant()`,
      withCheck: sql`${t.merchantId} = app_current_merchant()`,
    }),
    // Read-only access for app_page_merchant() (migration 0011), which resolves a
    // webhook's Page before any merchant context exists. app_page_resolver is
    // NOLOGIN and only owns that function; see migration 0009.
    pgPolicy('facebook_page_resolver_read', {
      for: 'select',
      to: 'app_page_resolver',
      using: sql`true`,
    }),
  ],
);

export type FacebookPageRow = typeof facebookPage.$inferSelect;
