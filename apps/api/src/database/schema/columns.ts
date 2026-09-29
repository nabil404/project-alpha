import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { pgPolicy, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { organization } from './auth';

/** Column and policy builders every business table shares. */

export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
export const merchantId = () =>
  text('merchant_id')
    .notNull()
    .references(() => organization.id);
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/**
 * Millisecond precision, for timestamps that sort a keyset-paginated list: the
 * cursor round-trips them through a JS Date, and microseconds would not survive it.
 */
export const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const merchantIsolation = (name: string, column: AnyPgColumn) =>
  pgPolicy(name, {
    for: 'all',
    using: sql`${column} = app_current_merchant()`,
    withCheck: sql`${column} = app_current_merchant()`,
  });

/** A CHECK body: the column holds one of these literals. Only ever called with code constants. */
export const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
