import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { Database } from './database.module.js';
import type * as schema from './schema/index.js';

/** The transaction object Drizzle hands to a db.transaction() callback. */
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Repository methods take an executor instead of reaching for this.db, so the
 * same method works inside and outside a transaction.
 */
export type Executor = Database | Transaction;

/** Every business-data method is scoped by the tenant. */
export interface TenantScope {
  merchantId: string;
}
