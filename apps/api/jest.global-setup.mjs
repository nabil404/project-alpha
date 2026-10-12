// Runs once before the specs. It loads the test-only variables, makes sure the
// test database exists and migrates it to the current schema. Specs read the
// variables through src/__tests__/test-env.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { parseEnv } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const TEST_KEYS = ['TEST_DATABASE_ADMIN_URL', 'TEST_REDIS_URL'];

/**
 * Copies only the TEST_* keys from environments/.env, so the app's dev
 * connections never reach a spec. Values already in the environment win,
 * which is how CI sets them.
 */
function loadTestEnv() {
  let file;
  try {
    file = parseEnv(readFileSync(join(import.meta.dirname, '../../environments/.env'), 'utf8'));
  } catch {
    return; // no environments/.env here, as in CI
  }
  for (const key of TEST_KEYS) {
    if (process.env[key] === undefined && file[key]) process.env[key] = file[key];
  }
}

/** Specs insert rows freely, so they must never point at a real database. */
function assertTestDatabase(url) {
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!name.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_ADMIN_URL names the database "${name}". Its name must end in _test, ` +
        'so specs can never write to a development or production database.',
    );
  }
  return name;
}

async function createDatabaseIfMissing(url, name) {
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.href });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

export default async function globalSetup() {
  loadTestEnv();
  const raw = process.env.TEST_DATABASE_ADMIN_URL;
  if (!raw) return; // the database-backed specs skip themselves

  const url = new URL(raw);
  const name = assertTestDatabase(url);
  await createDatabaseIfMissing(url, name);

  const pool = new pg.Pool({ connectionString: raw, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(import.meta.dirname, 'db/migrations') });
  } finally {
    await pool.end();
  }
}
