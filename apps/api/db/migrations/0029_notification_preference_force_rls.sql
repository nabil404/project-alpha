-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy (0028) but not
-- FORCE, so without this the owner would bypass it. db:verify-rls fails the
-- build if it is missing.
ALTER TABLE "notification_preference" FORCE ROW LEVEL SECURITY;
