import { sql } from 'drizzle-orm';
import type { Database } from './database.module.js';
import type { Transaction } from './base.repository.js';

/**
 * Runs `fn` with the tenant context row-level security policies read.
 *
 * Policies compare merchantId against `app_current_merchant()`, which reads the
 * transaction-local `app.current_merchant` setting. Something has to set it on
 * the same connection as the queries; this is that something.
 *
 * Three properties are load-bearing:
 *
 * - **Transaction-local** (`set_config(..., true)`). Pooled connections are
 *   reused, so a session-level setting would bleed one merchant's context into
 *   the next request served by that connection. The consequence is that every
 *   business query, reads included, now runs inside a transaction - budget
 *   against DATABASE_POOL_MAX and the pool's idle_in_transaction_session_timeout.
 * - **Never wrap a slow external call.** This opens a transaction, so putting an
 *   LLM or Graph API call inside the callback holds a connection for the length
 *   of that call. Read state, call outside, then open this to write.
 * - **Not the boundary.** Repositories still take `merchantId` and filter on it.
 *   RLS is the backstop for a query that forgets, not a licence to omit it.
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
