import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, merchantIsolation, updatedAt } from './columns';

/** Constraint name the ingest maps nothing from, exported for the schema spec. */
export const CUSTOMER_PSID_UQ = 'customer_merchant_psid_uq';

/**
 * Someone who messaged the shop's Page. The PSID is Page-scoped, and the same
 * person messaging two shops is correctly two rows: UNIQUE (merchant_id, psid).
 * Phone and address arrive with the orders work, which is what collects them.
 */
export const customer = pgTable(
  'customer',
  {
    id: id(),
    merchantId: merchantId(),
    psid: text('psid').notNull(),
    /** From the Graph profile; null until Facebook shares one. */
    name: text('name'),
    /** The last attempt to read the profile, successful or not. */
    profileFetchedAt: timestamp('profile_fetched_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customer_merchant_id_uq').on(t.merchantId, t.id),
    unique(CUSTOMER_PSID_UQ).on(t.merchantId, t.psid),
    // Search by name; the pg_trgm operator class comes from migration 0009.
    index('customer_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    merchantIsolation('customer_merchant_isolation', t.merchantId),
  ],
);

export type CustomerRow = typeof customer.$inferSelect;
