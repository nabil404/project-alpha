import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { ErrorCode } from '@app/shared';
import type { Database } from '../database.module.js';
import * as schema from '../schema/index.js';

// Needs a real Postgres: constraints, locks and policies are server behaviour.
// CI sets DATABASE_ADMIN_URL; locally, load apps/api/.env first. The admin role
// is a superuser, so RLS does not apply here - catalog-rls.spec.ts switches to
// app_runtime explicitly to test policies.
const url = process.env.DATABASE_ADMIN_URL;
export const describeDb = url ? describe : describe.skip;

export interface CatalogTestDb {
  db: Database;
  merchantA: string;
  merchantB: string;
  close(): Promise<void>;
}

/** Organization ids are random strings in Better Auth; shaped the same here. */
async function insertMerchant(db: Database): Promise<string> {
  const id = randomUUID().replaceAll('-', '');
  await db
    .insert(schema.organization)
    .values({ id, name: `Test ${id}`, slug: `test-${id}`, createdAt: new Date() });
  return id;
}

async function purge(db: Database, merchantIds: string[]): Promise<void> {
  // Junction and variants first; categories in one statement so the self-FK is
  // checked only once they are all gone.
  await db.delete(schema.productCategory).where(inArray(schema.productCategory.merchantId, merchantIds));
  await db.delete(schema.productVariant).where(inArray(schema.productVariant.merchantId, merchantIds));
  await db.delete(schema.product).where(inArray(schema.product.merchantId, merchantIds));
  await db.delete(schema.category).where(inArray(schema.category.merchantId, merchantIds));
  await db.delete(schema.organization).where(inArray(schema.organization.id, merchantIds));
}

export async function openCatalogTestDb(): Promise<CatalogTestDb> {
  // Several connections: the concurrency tests need two transactions at once.
  const pool = new Pool({ connectionString: url, max: 6 });
  const db = drizzle(pool, { schema });
  const merchantA = await insertMerchant(db);
  const merchantB = await insertMerchant(db);
  return {
    db,
    merchantA,
    merchantB,
    close: async () => {
      await purge(db, [merchantA, merchantB]);
      await pool.end();
    },
  };
}

export async function seedProduct(
  db: Database,
  merchantId: string,
  overrides: Partial<typeof schema.product.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.product)
    .values({ merchantId, name: 'Panjabi', ...overrides })
    .returning();
  if (!row) throw new Error('seedProduct returned no row');
  return row;
}

export async function seedVariant(
  db: Database,
  merchantId: string,
  productId: string,
  overrides: Partial<typeof schema.productVariant.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.productVariant)
    .values({
      merchantId,
      productId,
      name: 'M',
      sku: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
      price: 150000,
      stock: 5,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedVariant returned no row');
  return row;
}

export async function seedCategory(
  db: Database,
  merchantId: string,
  overrides: Partial<typeof schema.category.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.category)
    .values({ merchantId, name: `Cat ${randomUUID().slice(0, 8)}`, ...overrides })
    .returning();
  if (!row) throw new Error('seedCategory returned no row');
  return row;
}

/** The SQLSTATE and constraint a query failed with, read through Drizzle's wrapper. */
export async function pgErrorOf(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the query to fail');
    },
    (e: unknown) => e,
  );
  let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined;
  while (current && current.code === undefined && current.cause) {
    current = current.cause as typeof current;
  }
  return { code: current?.code, constraint: current?.constraint };
}

/** Asserts a Coded*Exception with exactly this code, not merely "it threw". */
export async function expectCoded(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ${code}, but the call succeeded`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
}
