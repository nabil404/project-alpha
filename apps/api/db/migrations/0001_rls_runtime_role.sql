-- Groundwork for row-level security: the parts drizzle-kit does not model.
--
-- Drizzle generates ENABLE ROW LEVEL SECURITY and CREATE POLICY from pgPolicy
-- in the schema, but not FORCE, roles, grants, default privileges or functions.
-- Those live here, authored through `drizzle-kit generate --custom`, which is
-- the documented escape hatch - not a hand-edited generated migration.
--
-- Nothing here enables RLS: no business table exists yet. This creates the role
-- and the context helper that make a future policy actually bite. Until a table
-- carries a policy, the merchantId predicate in every repository remains the
-- only tenant boundary.

-- Retained from the original schema: available for digest()/crypt() if needed.
-- gen_random_uuid() is built into Postgres 13+ and does not require it.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint

-- The runtime role the api and worker connect as.
--
-- NOBYPASSRLS is the default, but it is stated because it is the entire point:
-- a superuser ignores every policy unconditionally, and FORCE ROW LEVEL
-- SECURITY does not change that (FORCE closes the table *owner* bypass, which
-- is a different thing). Connecting as the bootstrap superuser would make every
-- policy silently inert.
--
-- Created NOLOGIN and without a password, so no credential lives in git. Each
-- environment sets one once, out of band:
--   ALTER ROLE app_runtime LOGIN PASSWORD '...';
-- docker/postgres-init does this automatically on a fresh volume. The guard
-- makes the two order-independent: whichever runs first, the other still works.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint

-- Existing objects. This runs after 0000_auth_tables, so it covers Better
-- Auth's seven tables - which need the grants, but must never get a policy:
-- they carry no merchant_id and the session lookup runs before any merchant
-- context exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
--> statement-breakpoint

-- Future objects, so a new table is reachable without a follow-up grant. These
-- attach to the role that *creates* the object, which is the role applying this
-- migration - the owner named by DATABASE_ADMIN_URL. Migrations must keep being
-- applied as that same role, or later tables land ungranted.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--> statement-breakpoint

-- The tenant context policies read, set per transaction by withMerchant()
-- in src/database/with-merchant.ts.
--
-- Returns text, not uuid. merchantId references organization.id, and the Better
-- Auth Organization plugin generates that id as TEXT - a random string, not a
-- UUID (see src/database/schema/auth.ts). A uuid-returning helper would not
-- type-check against the column it guards.
--
-- The NULLIF is load-bearing, and not for an edge case. A transaction-local
-- set_config does not unset the GUC at commit - it reverts to the setting's
-- reset value, which for a custom GUC is the empty string. On a pooled
-- connection that means every query after the first withMerchant() sees '',
-- not "unset". Without the NULLIF that empty string is a real value a policy
-- would compare against; with it, an absent context is NULL, the predicate is
-- NULL, and the policy exposes nothing. Pinned by
-- src/database/__tests__/with-merchant.spec.ts.
--
-- STABLE lets the planner evaluate it once per statement instead of per row.
CREATE FUNCTION app_current_merchant() RETURNS text
  LANGUAGE sql
  STABLE
  AS $$
    SELECT NULLIF(current_setting('app.current_merchant', true), '')
  $$;
--> statement-breakpoint

COMMENT ON FUNCTION app_current_merchant() IS
  'Transaction-local merchant for RLS policies. NULL when unset, so policies fail closed.';
