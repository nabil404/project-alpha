-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy for order_event
-- (0020_orders) but not FORCE, so without this the owner would bypass it.
-- db:verify-rls fails the build if it is missing.
ALTER TABLE "order_event" FORCE ROW LEVEL SECURITY;
