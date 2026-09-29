-- pg_trgm backs the conversation search indexes (customer.name, message.text)
-- that 0010_conversations creates. drizzle-kit does not model extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- The role app_page_merchant() (0011) runs as. The webhook worker must turn a
-- Page id into a merchant before any merchant context exists, and
-- facebook_page is under FORCE row-level security, which binds even its owner.
-- This role gets a read-only policy on that table (declared in pages.ts) and
-- two columns, owns the one function, and can never log in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_page_resolver') THEN
    CREATE ROLE app_page_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_page_resolver;
--> statement-breakpoint
GRANT SELECT (page_id, merchant_id) ON facebook_page TO app_page_resolver;
