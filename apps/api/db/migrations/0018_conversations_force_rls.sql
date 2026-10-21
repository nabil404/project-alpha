-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policies for these tables
-- (0014 to 0017) but not FORCE, so without this the owner would bypass them.
-- db:verify-rls fails the build if it is missing.
ALTER TABLE "customer" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_note" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message" FORCE ROW LEVEL SECURITY;
