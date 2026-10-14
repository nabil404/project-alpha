-- Every shop with a connected Page, for worker jobs that run before any
-- merchant context exists (the Messenger Profile backfill). It returns only
-- merchant ids. Same pattern as app_page_merchant() (0011): owned by
-- app_page_resolver (0009), whose only access is SELECT (page_id, merchant_id)
-- on facebook_page and the SELECT policy facebook_page_resolver_read, so what
-- the function can read does not rely on bypassing row-level security. The
-- ACL is settled before the ownership change, which carries it over, so
-- PUBLIC never holds EXECUTE on a function owned by the resolver. search_path
-- is pinned, as for any SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION app_connected_merchants() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT merchant_id FROM facebook_page ORDER BY merchant_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_connected_merchants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_connected_merchants() TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION app_connected_merchants() OWNER TO app_page_resolver;
