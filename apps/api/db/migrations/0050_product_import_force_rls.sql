-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies (0049) but not
-- FORCE, so without this the owner would bypass them. db:verify-rls fails the
-- build if it is missing.
ALTER TABLE "product_import" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_import_post" FORCE ROW LEVEL SECURITY;
