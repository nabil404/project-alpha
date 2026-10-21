-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0029 to 0031) but not FORCE, so without this the owner would bypass them.
-- db:verify-rls fails the build if it is missing.
ALTER TABLE "product_import" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_import_post" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "llm_call" FORCE ROW LEVEL SECURITY;
