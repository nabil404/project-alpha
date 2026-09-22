#!/usr/bin/env node
// Applies pending migrations as the schema owner.
//
// Uses drizzle-orm's programmatic migrator rather than `drizzle-kit migrate` so
// that the same command works in the production image, which carries drizzle-orm
// (a runtime dependency) and db/migrations, but not drizzle-kit or its TS config.
// Both read the same journal and __drizzle_migrations table, so local and deploy
// stay interchangeable.
//
// drizzle-kit is still what *generates* migrations; this only applies them.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// apps/api/.env is the repo's only env file and cwd here is apps/api. It is
// absent in CI and in the image, where the environment is already set.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env here
}

const connectionString = process.env.DATABASE_ADMIN_URL;

if (!connectionString) {
  console.error(
    'DATABASE_ADMIN_URL is not set. Migrations run as the owner; DATABASE_URL is\n' +
      'the restricted runtime role and cannot create tables.',
  );
  process.exit(2);
}

const pool = new Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder: 'db/migrations' });
  console.log('migrate: up to date.');
} finally {
  await pool.end();
}
