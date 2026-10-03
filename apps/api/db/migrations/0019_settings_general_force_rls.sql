-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy for merchant_settings
-- (0018_settings_general) but not FORCE, so without this the owner would bypass
-- it. db:verify-rls fails the build if it is missing.
ALTER TABLE "merchant_settings" FORCE ROW LEVEL SECURITY;
