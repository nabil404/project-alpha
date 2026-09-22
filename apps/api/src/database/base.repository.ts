import type { Kysely, Transaction } from 'kysely';
import type { DB } from './database.types.js';

/**
 * Repository methods take an executor instead of reaching for this.db, so the
 * same method works inside and outside a transaction.
 */
export type Executor = Kysely<DB> | Transaction<DB>;

/** Every business-data method is scoped by the tenant. */
export interface TenantScope {
  merchantId: string;
}
