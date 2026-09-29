-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0010_conversations) but not FORCE, so without this the owner would bypass
-- them. db:verify-rls fails the build if it is missing.
ALTER TABLE "customer" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Page id -> merchant id for the webhook worker, which has no merchant context
-- yet. It returns only the merchant id, and NULL for a Page nobody connected.
-- Owned by app_page_resolver (0009), whose only access is the SELECT policy
-- facebook_page_resolver_read, so it does not depend on the migrating role
-- being a superuser. search_path is pinned, as for any SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION app_page_merchant(p_page_id text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT merchant_id FROM facebook_page WHERE page_id = p_page_id $$;
--> statement-breakpoint
ALTER FUNCTION app_page_merchant(text) OWNER TO app_page_resolver;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_page_merchant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_page_merchant(text) TO app_runtime;
