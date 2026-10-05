/**
 * Desired state of the database, in dependency order. drizzle-kit diffs this
 * against db/migrations/meta and emits SQL; never hand-edit a generated
 * migration and never run `drizzle-kit push`.
 *
 * Sections:
 *   1. auth          (generated with the Better Auth CLI - do not hand-edit)
 *   2. pages
 *   3. catalog
 *   4. customers
 *   5. conversations
 *   6. orders
 *   7. settings
 *   8. delivery
 *
 * Money is stored as integer minor units (e.g. paisa/cents), never floats or
 * numeric. Every business table carries merchantId, and every one of them
 * declares a pgPolicy against app_current_merchant() - see with-merchant.ts.
 * `pnpm --filter api db:verify-rls` fails the build if one is missing.
 *
 * Every section has its file.
 */

export * from './auth';
export * from './pages';
export * from './catalog';
export * from './customers';
export * from './conversations';
export * from './orders';
export * from './settings';
export * from './delivery';
