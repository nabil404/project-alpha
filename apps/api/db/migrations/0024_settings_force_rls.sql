-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0019 to 0023) but not FORCE, so without this the owner would bypass them.
-- db:verify-rls fails the build if it is missing.
ALTER TABLE "merchant_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preference" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assistant_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "delivery_charge" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_delivery_charge" FORCE ROW LEVEL SECURITY;
