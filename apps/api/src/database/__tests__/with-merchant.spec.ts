import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '../database.module.js';
import type { Executor } from '../base.repository.js';
import * as schema from '../schema/index.js';
import { withMerchant } from '../with-merchant.js';

// Better Auth's Organization plugin generates organization.id as TEXT - a
// random string, not a uuid - and merchant_id references it. Shaped like the
// real thing so the fixtures do not imply a uuid column.
const merchantA = 'Xk3nQ8vB2mLp9wRtYs4dFgHj6cZa1eNu';
const merchantB = 'Pq7wE2rT9yUi4oAs6dFg1hJk3lZx5cVb';

/** Mirrors app_current_merchant() inline rather than calling it: these tests run
 *  before migrations are applied in CI, so the function may not exist yet. The
 *  NULLIF is the same one the migration uses, and it matters - see the
 *  'reverts to an empty string' test below. */
const readContext = async (executor: Executor) => {
  const result = await executor.execute<{ value: string | null }>(
    sql`select nullif(current_setting('app.current_merchant', true), '') as value`,
  );
  return result.rows[0]?.value ?? null;
};

/** The unguarded expression, to pin down the behaviour NULLIF exists for. */
const readRawContext = async (executor: Executor) => {
  const result = await executor.execute<{ value: string | null }>(
    sql`select current_setting('app.current_merchant', true) as value`,
  );
  return result.rows[0]?.value ?? null;
};

describe('withMerchant (no database)', () => {
  it('rejects a blank merchantId without opening a transaction', async () => {
    const db = {
      transaction: () => {
        throw new Error('transaction() must not be reached');
      },
    } as unknown as Database;

    await expect(withMerchant(db, '', async () => 'unreachable')).rejects.toThrow(
      /requires a merchantId/,
    );
  });
});

// The rest needs a real Postgres: transaction-locality is a server behaviour,
// not something a fake can demonstrate. CI sets DATABASE_ADMIN_URL; locally,
// export it (pointing at docker/compose.dev.yml) to run these.
const url = process.env.DATABASE_ADMIN_URL;
const describeDb = url ? describe : describe.skip;

describeDb('withMerchant (against Postgres)', () => {
  let db: Database;
  let pool: Pool;

  beforeAll(() => {
    // max: 1 is deliberate. Context bleed is only observable on a *reused*
    // connection, so a larger pool would let the leak assertions below pass by
    // landing on a fresh connection instead of by the context being cleared.
    pool = new Pool({ connectionString: url, max: 1 });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('exposes the merchant to queries inside the callback', async () => {
    const seen = await withMerchant(db, merchantA, (tx) => readContext(tx));
    expect(seen).toBe(merchantA);
  });

  it('hands the callback a transaction, not the pool', async () => {
    // A rollback inside the callback must undo the callback's writes, which is
    // only true if it really received a transaction.
    await expect(
      withMerchant(db, merchantA, async (tx) => {
        await tx.execute(sql`create temp table tx_probe (id int)`);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    await expect(db.execute(sql`select to_regclass('tx_probe') as t`)).resolves.toMatchObject({
      rows: [{ t: null }],
    });
  });

  it('does not leak the context to later queries after commit', async () => {
    await withMerchant(db, merchantA, (tx) => readContext(tx));
    // A pooled connection is reused; a session-level setting would still be here.
    await expect(readContext(db)).resolves.toBeNull();
  });

  it('does not leak the context after the transaction rolls back', async () => {
    await expect(
      withMerchant(db, merchantA, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(readContext(db)).resolves.toBeNull();
  });

  // This is why app_current_merchant() wraps the setting in NULLIF. A
  // transaction-local set_config does not unset the GUC at commit; it reverts to
  // its reset value, which for a custom GUC is ''. So on a pooled connection
  // every query after the first sees an empty string rather than nothing -
  // which, unguarded, is a real value a policy would compare against instead of
  // failing closed.
  it('reverts to an empty string rather than unset, which NULLIF turns back into null', async () => {
    await withMerchant(db, merchantA, (tx) => readContext(tx));

    await expect(readRawContext(db)).resolves.toBe('');
    await expect(readContext(db)).resolves.toBeNull();
  });

  it('scopes each call independently', async () => {
    const [a, b] = await Promise.all([
      withMerchant(db, merchantA, (tx) => readContext(tx)),
      withMerchant(db, merchantB, (tx) => readContext(tx)),
    ]);

    expect(a).toBe(merchantA);
    expect(b).toBe(merchantB);
  });
});
