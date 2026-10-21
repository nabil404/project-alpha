-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0033 and 0034) but not FORCE, so without this the owner would bypass them.
-- db:verify-rls fails the build if it is missing.
ALTER TABLE "ad_product" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_post" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An ad row belongs to its own shop's product (composite key). Removing the
-- product clears only product_id: merchant_id is NOT NULL, and the ad stays in
-- the "needs a product" list. Column-list SET NULL needs Postgres 15+.
ALTER TABLE "ad_product"
  ADD CONSTRAINT "ad_product_product_fk"
  FOREIGN KEY ("merchant_id", "product_id")
  REFERENCES "product" ("merchant_id", "id")
  ON DELETE SET NULL ("product_id");
--> statement-breakpoint
CREATE INDEX "ad_product_merchant_last_seen_idx" ON "ad_product" ("merchant_id", "last_seen_at" DESC);
