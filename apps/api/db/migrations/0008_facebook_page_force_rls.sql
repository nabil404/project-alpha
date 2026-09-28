-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy for facebook_page
-- (0007_facebook_page) but not FORCE, so without this the table owner would
-- bypass it. db:verify-rls fails the build if it is missing.
ALTER TABLE "facebook_page" FORCE ROW LEVEL SECURITY;
