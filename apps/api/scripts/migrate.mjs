#!/usr/bin/env node
// Applies pending migrations as the schema owner. It uses drizzle-orm's
// migrator because the production image has drizzle-orm and db/migrations but
// not drizzle-kit. Both read the same journal and __drizzle_migrations table.
// drizzle-kit still generates migrations.

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// environments/.env is the repo's only env file and cwd here is apps/api. It is
// absent in CI and in the image, where the environment is already set.
try {
  process.loadEnvFile('../../environments/.env');
} catch {
  // no environments/.env here
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
