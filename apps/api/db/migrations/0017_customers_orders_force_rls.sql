-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0016_customers_orders) but not FORCE, so without this the owner would bypass
-- them. db:verify-rls fails the build if it is missing.
ALTER TABLE "customer_note" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_item" FORCE ROW LEVEL SECURITY;
