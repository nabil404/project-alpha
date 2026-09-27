-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy for product_image
-- (0005_product_image) but not FORCE, so without this the table owner would
-- bypass it. db:verify-rls fails the build if it is missing.
ALTER TABLE "product_image" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Composite, like every catalog link, so a variant cannot point at another
-- merchant's image. SET NULL names its column: a plain composite SET NULL would
-- null merchant_id as well and fail its NOT NULL. drizzle-kit cannot model the
-- column list (Postgres 15+), so the key lives here, not in catalog.ts.
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_image_fk"
  FOREIGN KEY ("merchant_id", "image_id")
  REFERENCES "product_image" ("merchant_id", "id") ON DELETE SET NULL ("image_id");
