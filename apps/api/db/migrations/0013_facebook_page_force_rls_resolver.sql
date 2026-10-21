-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for
-- facebook_page (0012_facebook_page) but not FORCE, so without this the table
-- owner would bypass them. db:verify-rls fails the build if it is missing.
ALTER TABLE "facebook_page" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT (page_id, merchant_id) ON facebook_page TO app_page_resolver;
--> statement-breakpoint

-- Page id -> merchant id for the webhook worker, which has no merchant context
-- yet. It returns only the merchant id, and NULL for a Page nobody connected.
-- Owned by app_page_resolver (0011), whose only access is two columns and the
-- SELECT policy facebook_page_resolver_read, so what the function can read does
-- not rely on bypassing row-level security. Changing its owner does need a
-- superuser or SET membership in app_page_resolver. The ACL is settled before
-- the ownership change, which carries it over, so PUBLIC never holds EXECUTE
-- on a function owned by the resolver. search_path is pinned, as for any
-- SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION app_page_merchant(p_page_id text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT merchant_id FROM facebook_page WHERE page_id = p_page_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_page_merchant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_page_merchant(text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION app_page_merchant(text) OWNER TO app_page_resolver;
--> statement-breakpoint

-- Every shop with a connected Page, for worker jobs that run before any
-- merchant context exists (the Messenger Profile backfill). It returns only
-- merchant ids. Same pattern and owner as app_page_merchant() above.
CREATE OR REPLACE FUNCTION app_connected_merchants() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT merchant_id FROM facebook_page ORDER BY merchant_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_connected_merchants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_connected_merchants() TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION app_connected_merchants() OWNER TO app_page_resolver;
