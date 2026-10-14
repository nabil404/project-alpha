/**
 * Desired state of the database, in dependency order. drizzle-kit diffs this
 * against db/migrations/meta to generate SQL. auth.ts comes from the Better
 * Auth CLI; do not hand-edit it.
 *
 * Money is integer minor units, never floats or numeric. Every business table
 * carries merchantId and a pgPolicy against app_current_merchant(), and
 * `pnpm --filter api db:verify-rls` fails if one is missing.
 */

export * from './auth';
export * from './pages';
export * from './catalog';
export * from './customers';
export * from './conversations';
export * from './orders';
export * from './settings';
export * from './delivery';
export * from './assistant';
export * from './ads';
export * from './posts';
