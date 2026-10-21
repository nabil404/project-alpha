-- pg_trgm backs the conversation search indexes (customer.name, message.text)
-- that 0014_customer and 0017_message create. drizzle-kit does not model
-- extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- The role app_page_merchant() and app_connected_merchants() (0013) run as.
-- The webhook worker must turn a Page id into a merchant before any merchant
-- context exists, and facebook_page is under FORCE row-level security, which
-- binds even its owner. This role gets a read-only policy on that table
-- (declared in pages.ts, created by 0012_facebook_page) and two columns, owns
-- the functions, and can never log in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_page_resolver') THEN
    CREATE ROLE app_page_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_page_resolver;
