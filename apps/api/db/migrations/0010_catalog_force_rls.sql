-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for the catalog
-- tables (0002 to 0009) but not FORCE, so without this the table owner would
-- bypass them. db:verify-rls fails the build if any of these is missing.
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_image" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_variant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_category" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_option" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_option_value" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_variant_option_value" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Composite, like every catalog link, so a product or variant cannot point at
-- another merchant's image. SET NULL names its column: a plain composite SET
-- NULL would null merchant_id as well and fail its NOT NULL. drizzle-kit cannot
-- model the column list (Postgres 15+), so these keys live here, not in
-- catalog.ts.
ALTER TABLE "product" ADD CONSTRAINT "product_cover_image_fk"
  FOREIGN KEY ("merchant_id", "cover_image_id")
  REFERENCES "product_image" ("merchant_id", "id") ON DELETE SET NULL ("cover_image_id");
--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_image_fk"
  FOREIGN KEY ("merchant_id", "image_id")
  REFERENCES "product_image" ("merchant_id", "id") ON DELETE SET NULL ("image_id");
