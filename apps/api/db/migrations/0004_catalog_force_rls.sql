-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for the catalog
-- tables (0003_catalog) but not FORCE, so without this the table owner would
-- bypass them. db:verify-rls fails the build if any of these is missing.
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_variant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_category" FORCE ROW LEVEL SECURITY;
