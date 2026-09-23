#!/usr/bin/env node
// Drift backstop for row-level security.
//
// drizzle-kit generates ENABLE ROW LEVEL SECURITY and CREATE POLICY from
// pgPolicy in the schema, but it does not model FORCE. So a table can carry a
// policy, look protected, and still be bypassable by its owner, with nothing in
// the generate/migrate loop to notice. This closes that gap: every table
// carrying merchant_id must have RLS enabled, forced, and at least one policy.
//
// It catches a forgotten migration. It does not check that a policy is
// *correct* - that is what the two-merchant repository tests are for.
//
// Runs as the owner (DATABASE_ADMIN_URL): pg_policies only shows policies on
// tables the connected role can see.

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
  console.error('DATABASE_ADMIN_URL is not set.');
  process.exit(2);
}

const QUERY = `
  SELECT c.relname                                AS table_name,
         c.relrowsecurity                         AS enabled,
         c.relforcerowsecurity                    AS forced,
         count(p.polname)                         AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attname = 'merchant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
  ORDER BY c.relname
`;

const pool = new Pool({ connectionString });

try {
  const { rows } = await pool.query(QUERY);

  if (rows.length === 0) {
    console.log('verify-rls: no tables carry merchant_id yet - nothing to check.');
    process.exit(0);
  }

  const failures = [];

  for (const row of rows) {
    const missing = [];
    if (!row.enabled) missing.push('ENABLE ROW LEVEL SECURITY');
    if (!row.forced) missing.push('FORCE ROW LEVEL SECURITY');
    // count() comes back as a string from Postgres.
    if (Number(row.policies) === 0) missing.push('a policy');

    if (missing.length > 0) {
      failures.push(`  ${row.table_name}: missing ${missing.join(', ')}`);
    } else {
      console.log(`  ok  ${row.table_name} (${row.policies} policy/policies)`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nverify-rls: ${failures.length} of ${rows.length} tenant table(s) are unprotected:\n` +
        `${failures.join('\n')}\n\n` +
        'Declare the policy with pgPolicy in the schema, and add FORCE ROW LEVEL ' +
        'SECURITY in a migration from `pnpm --filter api db:custom`.',
    );
    process.exit(1);
  }

  console.log(`verify-rls: ${rows.length} tenant table(s) protected.`);
} finally {
  await pool.end();
}
