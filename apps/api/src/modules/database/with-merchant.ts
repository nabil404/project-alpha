import { sql } from 'drizzle-orm';
import type { Database } from './database.module';
import type { Transaction } from './base.repository';

/**
 * Runs `fn` in a transaction with `app.current_merchant` set. RLS policies
 * read it through `app_current_merchant()`.
 *
 * - The setting is transaction-local (`set_config(..., true)`), because a
 *   session-level one would leak into the next request on the same pooled
 *   connection. So every business query, reads included, holds a transaction.
 *   Budget DATABASE_POOL_MAX and idle_in_transaction_session_timeout for it.
 * - Never call the LLM or Graph inside `fn`. Read, call outside, then open
 *   this to write.
 * - Repositories still filter on `merchantId`. RLS catches a query that forgets.
 */
export async function withMerchant<T>(
  db: Database,
  merchantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  // An empty context is indistinguishable from an unset one: the helper returns
  // NULL and policies expose nothing. Failing closed is correct, but silently
  // returning no rows hides the bug, so reject it here where it is still legible.
  if (!merchantId) {
    throw new Error('withMerchant requires a merchantId; refusing to open an unscoped transaction');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_merchant', ${merchantId}, true)`);
    return fn(tx);
  });
}
