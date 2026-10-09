-- drizzle-kit emits ENABLE ROW LEVEL SECURITY and the policy (0031) but not
-- FORCE, so without this the owner would bypass it. db:verify-rls fails the
-- build if it is missing.
ALTER TABLE "llm_call" FORCE ROW LEVEL SECURITY;
