import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { ErrorCode } from '@app/shared';
import type { Database } from '../database.module';
import { productImageKeys } from '../../products/images/product-image-keys';
import * as schema from '../schema/index';

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
  // checked only once they are all gone. Images cascade from their product.
  await db
    .delete(schema.productCategory)
    .where(inArray(schema.productCategory.merchantId, merchantIds));
  await db
    .delete(schema.productVariant)
    .where(inArray(schema.productVariant.merchantId, merchantIds));
  await db.delete(schema.product).where(inArray(schema.product.merchantId, merchantIds));
  await db.delete(schema.category).where(inArray(schema.category.merchantId, merchantIds));
  // Orders and notes point at customers and conversations, so they go first.
  await db.delete(schema.orderItem).where(inArray(schema.orderItem.merchantId, merchantIds));
  await db.delete(schema.order).where(inArray(schema.order.merchantId, merchantIds));
  await db.delete(schema.customerNote).where(inArray(schema.customerNote.merchantId, merchantIds));
  // Conversations: messages cascade from their conversation, but delete them
  // explicitly so a failed test cannot leave a row holding the merchant.
  await db.delete(schema.message).where(inArray(schema.message.merchantId, merchantIds));
  await db.delete(schema.conversation).where(inArray(schema.conversation.merchantId, merchantIds));
  await db.delete(schema.customer).where(inArray(schema.customer.merchantId, merchantIds));
  await db.delete(schema.facebookPage).where(inArray(schema.facebookPage.merchantId, merchantIds));
  await db
    .delete(schema.merchantSettings)
    .where(inArray(schema.merchantSettings.merchantId, merchantIds));
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

/**
 * A second handle whose every connection is app_runtime, the role the api and
 * worker use, for code that opens its own transactions (so SET LOCAL ROLE
 * cannot reach it). RLS applies exactly as in production. The role is a
 * startup option, so it is in force before the connection runs anything.
 */
export function openRuntimeDb(): { db: Database; close(): Promise<void> } {
  const pool = new Pool({ connectionString: url, max: 4, options: '-c role=app_runtime' });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
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

export async function seedOption(
  db: Database,
  merchantId: string,
  productId: string,
  overrides: Partial<typeof schema.productOption.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.productOption)
    .values({
      merchantId,
      productId,
      name: `Opt ${randomUUID().slice(0, 8)}`,
      position: 0,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedOption returned no row');
  return row;
}

export async function seedOptionValue(
  db: Database,
  merchantId: string,
  optionId: string,
  overrides: Partial<typeof schema.productOptionValue.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.productOptionValue)
    .values({ merchantId, optionId, value: 'M', position: 0, ...overrides })
    .returning();
  if (!row) throw new Error('seedOptionValue returned no row');
  return row;
}

/** A row only - nothing in object storage. */
export async function seedImage(
  db: Database,
  merchantId: string,
  productId: string,
  overrides: Partial<typeof schema.productImage.$inferInsert> = {},
) {
  const id = overrides.id ?? randomUUID();
  const [row] = await db
    .insert(schema.productImage)
    .values({
      id,
      merchantId,
      productId,
      storageKey: productImageKeys(merchantId, id).full,
      position: 0,
      width: 100,
      height: 100,
      byteSize: 1000,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seedImage returned no row');
  return row;
}

/** Rows at positions 0..count-1, cover first. */
export async function seedImages(
  db: Database,
  merchantId: string,
  productId: string,
  count: number,
) {
  const rows = [];
  for (let position = 0; position < count; position++) {
    rows.push(await seedImage(db, merchantId, productId, { position }));
  }
  return rows;
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
