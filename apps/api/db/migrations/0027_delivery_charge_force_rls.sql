-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies (0026) but not
-- FORCE, so without this the owner would bypass them. db:verify-rls fails the
-- build if it is missing.
ALTER TABLE "delivery_charge" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_delivery_charge" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An order belongs to its own shop's delivery charge (composite key). Removing
-- it clears only delivery_charge_id: merchant_id is NOT NULL, and the order
-- keeps the area name and estimate. Column-list SET NULL needs Postgres 15+.
ALTER TABLE "order"
  ADD CONSTRAINT "order_delivery_charge_fk"
  FOREIGN KEY ("merchant_id", "delivery_charge_id")
  REFERENCES "delivery_charge" ("merchant_id", "id")
  ON DELETE SET NULL ("delivery_charge_id");
